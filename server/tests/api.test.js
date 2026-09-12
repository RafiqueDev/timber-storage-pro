import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, "test-api.db");

function cleanupDbFiles() {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = testDbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
cleanupDbFiles();

// Must be set BEFORE importing db.js / app.js, since better-sqlite3 opens
// the file at module-evaluation time.
process.env.DB_FILE = testDbPath;
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";

const { default: db } = await import("../src/db.js");
const { default: app } = await import("../src/app.js");

let server;
let baseUrl;
let adminToken, staffToken;
let wh1Id, wh2Id, partyId;

before(() => {
  db.prepare("INSERT INTO companies (id, name, next_invoice_seq) VALUES ('default','Test Co',1)").run();

  wh1Id = nanoid();
  wh2Id = nanoid();
  db.prepare("INSERT INTO warehouses (id, company_id, branch_name) VALUES (?, 'default', 'WH1')").run(wh1Id);
  db.prepare("INSERT INTO warehouses (id, company_id, branch_name) VALUES (?, 'default', 'WH2')").run(wh2Id);

  const adminId = nanoid();
  db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (?, 'Admin', 'admin', ?, 'SUPER_ADMIN')").run(
    adminId,
    bcrypt.hashSync("admin123", 10)
  );

  const staffId = nanoid();
  db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (?, 'Staff', 'staff', ?, 'STAFF')").run(
    staffId,
    bcrypt.hashSync("staff123", 10)
  );
  db.prepare("INSERT INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)").run(staffId, wh1Id);

  partyId = nanoid();
  db.prepare("INSERT INTO parties (id, party_name) VALUES (?, 'Test Party')").run(partyId);

  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}/api`;
});

after(() => {
  server.close();
  cleanupDbFiles();
});

async function post(url, body, token) {
  const res = await fetch(baseUrl + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function get(url, token) {
  const res = await fetch(baseUrl + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, data: await res.json() };
}
async function put(url, body, token) {
  const res = await fetch(baseUrl + url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test("login issues tokens for both roles", async () => {
  const admin = await post("/auth/login", { username: "admin", password: "admin123" });
  assert.equal(admin.status, 200);
  assert.ok(admin.data.data.accessToken);
  adminToken = admin.data.data.accessToken;

  const staff = await post("/auth/login", { username: "staff", password: "staff123" });
  assert.equal(staff.status, 200);
  staffToken = staff.data.data.accessToken;

  const bad = await post("/auth/login", { username: "admin", password: "wrong" });
  assert.equal(bad.status, 401);
});

test("warehouse isolation — staff gets 403 outside their assigned warehouse", async () => {
  const r = await get(`/containers?warehouse_id=${wh2Id}`, staffToken);
  assert.equal(r.status, 403);

  const create = await post(
    "/containers",
    { warehouse_id: wh2Id, party_id: partyId, container_number: "HACK-1", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    staffToken
  );
  assert.equal(create.status, 403);
});

let containerId;
test("critical test case (spec #110) — over-loading beyond remaining stock is rejected", async () => {
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-T1", date_of_unloading: "2026-01-01", initial_packets: 500, rent_type: "Daily", rent_rate: 500 },
    adminToken
  );
  assert.equal(c.status, 201);
  containerId = c.data.data.id;

  for (const qty of [100, 150, 200]) {
    const r = await post("/loading", { container_id: containerId, date_of_loading: "2026-01-10", packets_loaded: qty }, adminToken);
    assert.equal(r.status, 201);
  }

  const detailBefore = await get(`/containers/${containerId}`, adminToken);
  assert.equal(detailBefore.data.data.remaining_packets, 50);

  const rejected = await post("/loading", { container_id: containerId, date_of_loading: "2026-01-20", packets_loaded: 60 }, adminToken);
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.message, /cannot exceed/i);

  const detailAfter = await get(`/containers/${containerId}`, adminToken);
  assert.equal(detailAfter.data.data.remaining_packets, 50, "remaining stock must be unchanged after a rejected load");
});

test("duplicate container numbers within a warehouse are rejected", async () => {
  await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "DUP-1", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const dup = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "DUP-1", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  assert.equal(dup.status, 409);
});

test("billing formulas (spec #111) — Daily and Monthly match exactly", async () => {
  const daily = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-DAILY", date_of_unloading: "2026-01-01", initial_packets: 100, rent_type: "Daily", rent_rate: 500 },
    adminToken
  );
  const inv1 = await post(
    "/invoices",
    { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: daily.data.data.id, billable_days: 20 }] },
    adminToken
  );
  assert.equal(inv1.status, 201);
  assert.equal(inv1.data.data.subtotal, 10000);

  const monthly = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-MONTHLY", date_of_unloading: "2026-01-01", initial_packets: 100, rent_type: "Monthly", rent_rate: 15000 },
    adminToken
  );
  const inv2 = await post(
    "/invoices",
    { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: monthly.data.data.id, billable_days: 20 }] },
    adminToken
  );
  assert.equal(inv2.status, 201);
  assert.equal(inv2.data.data.subtotal, 10000);
});

test("cleared containers remain eligible for a final bill instead of disappearing", async () => {
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-CLEARED", date_of_unloading: "2026-01-01", initial_packets: 50, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const cid = c.data.data.id;

  // 2026-01-01 -> 2026-03-06 is exactly 64 days (2 months + 4 days), matching
  // the "irregular duration" example from the requirements.
  const load = await post("/loading", { container_id: cid, date_of_loading: "2026-03-06", packets_loaded: 50 }, adminToken);
  assert.equal(load.status, 201);

  const detail = await get(`/containers/${cid}`, adminToken);
  assert.equal(detail.data.data.status, "Cleared");
  assert.equal(detail.data.data.last_loading_date, "2026-03-06");
  assert.equal(detail.data.data.default_billable_days, 64, "accrued days must freeze at the last loading date, not keep counting to today");

  const eligible = await get(`/invoices/eligible-containers?party_id=${partyId}&warehouse_id=${wh1Id}`, adminToken);
  const found = eligible.data.data.find((x) => x.id === cid);
  assert.ok(found, "a fully cleared container must still appear as eligible for billing");
  assert.equal(found.defaultDays, 64);
  assert.equal(found.exactBreakdown.months, 2);
  assert.equal(found.exactBreakdown.remainingDays, 4);
  assert.equal(found.roundDownMonthsDays, 60);

  // Bill it for the exact 64 days at Rs.100/day = 6400
  const inv = await post("/invoices", { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: cid, billable_days: 64 }] }, adminToken);
  assert.equal(inv.status, 201);
  assert.equal(inv.data.data.subtotal, 6400);
});

test("payments cannot exceed the invoice balance, and correctly flip status to Partially Paid / Paid", async () => {
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-PAY", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv = await post("/invoices", { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: c.data.data.id, billable_days: 10 }] }, adminToken);
  assert.equal(inv.data.data.subtotal, 1000);

  const overpay = await post("/payments", { invoice_id: inv.data.data.id, amount: 999999, payment_date: "2026-01-11" }, adminToken);
  assert.equal(overpay.status, 400);

  const partial = await post("/payments", { invoice_id: inv.data.data.id, amount: 400, payment_date: "2026-01-11" }, adminToken);
  assert.equal(partial.status, 201);
  assert.equal(partial.data.data.invoice.status, "Partially Paid");
  assert.equal(partial.data.data.invoice.balance, 600);

  const final = await post("/payments", { invoice_id: inv.data.data.id, amount: 600, payment_date: "2026-01-12" }, adminToken);
  assert.equal(final.status, 201);
  assert.equal(final.data.data.invoice.status, "Paid");
  assert.equal(final.data.data.invoice.balance, 0);
});

test("issuing an adjustment banks the credit — it does NOT touch current outstanding balance, only the party's NEXT bill", async () => {
  // Dedicated party for this and the following credit-banking test so the
  // banked credit can't leak into unrelated tests that share `partyId`.
  const creditParty = await post("/parties", { party_name: "Credit Test Party" }, adminToken);
  const creditPartyId = creditParty.data.data.id;

  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: creditPartyId, container_number: "CONT-ADJ", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv = await post("/invoices", { party_id: creditPartyId, warehouse_id: wh1Id, lines: [{ container_id: c.data.data.id, billable_days: 10 }] }, adminToken);
  assert.equal(inv.data.data.subtotal, 1000);

  // Fully pay the original invoice first, matching the real workflow this
  // was requested for: "if there is all cleared payment and then I add
  // issuance adjustment, it will adjust later when we make another bill".
  await post("/payments", { invoice_id: inv.data.data.id, amount: 1000, payment_date: "2026-01-11" }, adminToken);

  const adjust = await post(`/invoices/${inv.data.data.id}/adjust`, { amount: 200, reason: "Billing dispute resolved" }, adminToken);
  assert.equal(adjust.status, 201);
  assert.equal(adjust.data.data.type, "CreditNote");
  assert.equal(adjust.data.data.subtotal, -200);
  assert.equal(adjust.data.data.balance, 0, "a fresh credit note must NOT reduce current outstanding balance");
  assert.equal(adjust.data.data.credit_remaining, 200, "the full amount must be banked as available credit");
  assert.equal(adjust.data.data.adjustment_for, inv.data.data.id);

  // Original invoice's own stored numbers must be untouched — still fully paid, unaffected by the adjustment.
  const original = await get(`/invoices/${inv.data.data.id}`, adminToken);
  assert.equal(original.data.data.subtotal, 1000);
  assert.equal(original.data.data.balance, 0);
  assert.equal(original.data.data.adjustments.length, 1);

  // The party's available credit should now show 200, not affect outstanding.
  const partyDetail = await get(`/parties/${creditPartyId}`, adminToken);
  assert.equal(partyDetail.data.data.availableCredit, 200);
  assert.equal(partyDetail.data.data.outstandingBalance, 0);

  return creditPartyId;
});

test("banked credit is automatically applied to the party's NEXT bill", async () => {
  const creditParty = await post("/parties", { party_name: "Credit Auto-Apply Party" }, adminToken);
  const creditPartyId = creditParty.data.data.id;

  const c1 = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: creditPartyId, container_number: "CONT-CREDIT-1", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv1 = await post("/invoices", { party_id: creditPartyId, warehouse_id: wh1Id, lines: [{ container_id: c1.data.data.id, billable_days: 10 }] }, adminToken);
  await post("/payments", { invoice_id: inv1.data.data.id, amount: 1000, payment_date: "2026-01-11" }, adminToken);
  const adjust = await post(`/invoices/${inv1.data.data.id}/adjust`, { amount: 300, reason: "Goodwill credit" }, adminToken);
  assert.equal(adjust.data.data.credit_remaining, 300);

  // Generate a second, later bill for the same party — the banked 300
  // credit should automatically apply to it, oldest-credit-first.
  const c2 = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: creditPartyId, container_number: "CONT-CREDIT-2", date_of_unloading: "2026-02-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv2 = await post("/invoices", { party_id: creditPartyId, warehouse_id: wh1Id, lines: [{ container_id: c2.data.data.id, billable_days: 10 }] }, adminToken);
  assert.equal(inv2.data.data.subtotal, 1000);
  assert.equal(inv2.data.data.paid_amount, 300, "the banked 300 credit should auto-apply as a payment on the new invoice");
  assert.equal(inv2.data.data.balance, 700);
  assert.equal(inv2.data.data.status, "Partially Paid");

  // The credit note should now show zero remaining.
  const creditCheck = await get(`/invoices/${adjust.data.data.id}`, adminToken);
  assert.equal(creditCheck.data.data.credit_remaining, 0);

  // The new invoice's payments list should show the auto-applied credit.
  const inv2Detail = await get(`/invoices/${inv2.data.data.id}`, adminToken);
  const creditPayment = inv2Detail.data.data.payments.find((p) => p.payment_method === "Credit Note");
  assert.ok(creditPayment, "the new invoice must show an auto-applied Credit Note payment");
  assert.equal(creditPayment.amount, 300);

  const partyDetail = await get(`/parties/${creditPartyId}`, adminToken);
  assert.equal(partyDetail.data.data.availableCredit, 0);
});

test("undo (delete) is blocked once money has moved, but allowed for genuine mistakes", async () => {
  // A freshly generated, unpaid invoice can be undone entirely.
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-UNDO-INV", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv = await post("/invoices", { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: c.data.data.id, billable_days: 5 }] }, adminToken);
  const del = await fetch(`${baseUrl}/invoices/${inv.data.data.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(del.status, 200);
  const gone = await get(`/invoices/${inv.data.data.id}`, adminToken);
  assert.equal(gone.status, 404);

  // Once paid, it can no longer be undone.
  const inv2 = await post("/invoices", { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: c.data.data.id, billable_days: 5 }] }, adminToken);
  await post("/payments", { invoice_id: inv2.data.data.id, amount: inv2.data.data.subtotal, payment_date: "2026-01-06" }, adminToken);
  const blockedDel = await fetch(`${baseUrl}/invoices/${inv2.data.data.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(blockedDel.status, 400);

  // A container with no history can be undone.
  const freshContainer = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-UNDO-FRESH", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const delContainer = await fetch(`${baseUrl}/containers/${freshContainer.data.data.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(delContainer.status, 200);

  // A container with loading recorded cannot be undone.
  await post("/loading", { container_id: c.data.data.id, date_of_loading: "2026-01-02", packets_loaded: 1 }, adminToken);
  const delWithHistory = await fetch(`${baseUrl}/containers/${c.data.data.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(delWithHistory.status, 400);
});

test("deleting a loading record recomputes the container correctly (undo)", async () => {
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-UNDO-LOAD", date_of_unloading: "2026-01-01", initial_packets: 50, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const cid = c.data.data.id;
  const log1 = await post("/loading", { container_id: cid, date_of_loading: "2026-01-05", packets_loaded: 20 }, adminToken);
  await post("/loading", { container_id: cid, date_of_loading: "2026-01-10", packets_loaded: 10 }, adminToken);

  let detail = await get(`/containers/${cid}`, adminToken);
  assert.equal(detail.data.data.loaded_packets, 30);

  const del = await fetch(`${baseUrl}/loading/${log1.data.data.log.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(del.status, 200);

  detail = await get(`/containers/${cid}`, adminToken);
  assert.equal(detail.data.data.loaded_packets, 10, "removing a log must recompute the container total from the remaining logs");
});

test("deleting an auto-applied credit payment refunds the credit note", async () => {
  const creditParty = await post("/parties", { party_name: "Undo Credit Party" }, adminToken);
  const creditPartyId = creditParty.data.data.id;
  const c1 = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: creditPartyId, container_number: "CONT-UNDOCREDIT-1", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv1 = await post("/invoices", { party_id: creditPartyId, warehouse_id: wh1Id, lines: [{ container_id: c1.data.data.id, billable_days: 10 }] }, adminToken);
  await post("/payments", { invoice_id: inv1.data.data.id, amount: 1000, payment_date: "2026-01-11" }, adminToken);
  const adjust = await post(`/invoices/${inv1.data.data.id}/adjust`, { amount: 150, reason: "Test refund" }, adminToken);

  const c2 = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: creditPartyId, container_number: "CONT-UNDOCREDIT-2", date_of_unloading: "2026-02-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv2 = await post("/invoices", { party_id: creditPartyId, warehouse_id: wh1Id, lines: [{ container_id: c2.data.data.id, billable_days: 10 }] }, adminToken);
  assert.equal(inv2.data.data.paid_amount, 150);

  const inv2Detail = await get(`/invoices/${inv2.data.data.id}`, adminToken);
  const creditPayment = inv2Detail.data.data.payments.find((p) => p.payment_method === "Credit Note");

  const del = await fetch(`${baseUrl}/payments/${creditPayment.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(del.status, 200);

  const creditRefunded = await get(`/invoices/${adjust.data.data.id}`, adminToken);
  assert.equal(creditRefunded.data.data.credit_remaining, 150, "undoing the auto-applied payment must refund the credit note");

  const inv2After = await get(`/invoices/${inv2.data.data.id}`, adminToken);
  assert.equal(inv2After.data.data.paid_amount, 0);
  assert.equal(inv2After.data.data.balance, 1000);
});

test("cross-warehouse authorization is enforced on reports, dashboard, audit logs, and payments", async () => {
  const forbiddenReport = await get(`/reports/storage?warehouse_id=${wh2Id}`, staffToken);
  assert.equal(forbiddenReport.status, 403);

  const forbiddenDashboard = await get(`/dashboard?warehouse_id=${wh2Id}`, staffToken);
  assert.equal(forbiddenDashboard.status, 403);

  const forbiddenPayments = await get(`/payments?warehouse_id=${wh2Id}`, staffToken);
  assert.equal(forbiddenPayments.status, 403);

  // Listing payments with NO warehouse filter must never silently return
  // system-wide data for a non-admin — only their own assigned warehouses.
  const allPayments = await get(`/payments`, staffToken);
  assert.equal(allPayments.status, 200);
  assert.ok(allPayments.data.data.every((p) => p.invoice_number)); // sanity: shape is fine
});

// Regression test for a real bug report: a brand-new Active container with
// 0 days accrued so far was being marked "fullyBilled" (same flag used for
// a genuinely exhausted Cleared container), which disabled its checkbox and
// made it impossible to bill. Only a Cleared container with nothing left to
// invoice should ever be "fullyBilled" — a fresh Active one must not be.
test("a brand-new Active container is never marked fullyBilled, only an exhausted Cleared one is", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const fresh = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-FRESH", date_of_unloading: today, initial_packets: 20, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  assert.equal(fresh.status, 201);

  const eligible = await get(`/invoices/eligible-containers?party_id=${partyId}&warehouse_id=${wh1Id}`, adminToken);
  const freshEntry = eligible.data.data.find((x) => x.id === fresh.data.data.id);
  assert.ok(freshEntry, "a freshly created container must appear in eligible-containers");
  assert.equal(freshEntry.defaultDays, 0);
  assert.equal(freshEntry.fullyBilled, false, "a brand-new container with 0 accrued days must NOT be marked fullyBilled");

  // Clear it out completely and fully invoice it — only THIS should be fullyBilled.
  await post("/loading", { container_id: fresh.data.data.id, date_of_loading: today, packets_loaded: 20 }, adminToken);
  const invoiceIt = await post("/invoices", { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: fresh.data.data.id, billable_days: 0 }] }, adminToken);
  assert.equal(invoiceIt.status, 201);

  const eligibleAfter = await get(`/invoices/eligible-containers?party_id=${partyId}&warehouse_id=${wh1Id}`, adminToken);
  const clearedEntry = eligibleAfter.data.data.find((x) => x.id === fresh.data.data.id);
  assert.equal(clearedEntry.status, "Cleared");
  assert.equal(clearedEntry.fullyBilled, true, "a Cleared container already invoiced up to its clearance date should be fullyBilled");
});

test("invoice edit recalculates totals and is blocked once a payment exists", async () => {
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-EDIT", date_of_unloading: "2026-01-01", initial_packets: 10, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv = await post("/invoices", { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: c.data.data.id, billable_days: 10 }] }, adminToken);
  assert.equal(inv.data.data.subtotal, 1000);

  const itemId = inv.data.data.items[0].id;
  const edited = await put(`/invoices/${inv.data.data.id}`, { invoice_date: "2026-01-05", items: [{ id: itemId, billable_days: 15 }] }, adminToken);
  assert.equal(edited.status, 200);
  assert.equal(edited.data.data.subtotal, 1500);

  await post("/payments", { invoice_id: inv.data.data.id, amount: 500, payment_date: "2026-01-06" }, adminToken);

  const editAfterPayment = await put(`/invoices/${inv.data.data.id}`, { invoice_date: "2026-01-05", items: [{ id: itemId, billable_days: 20 }] }, adminToken);
  assert.equal(editAfterPayment.status, 400);
  assert.match(editAfterPayment.data.message, /Issue Adjustment/i);
});

test("party list returns container counts side by side", async () => {
  const rows = await get(`/parties?warehouse_id=${wh1Id}`, adminToken);
  assert.equal(rows.status, 200);
  const party = rows.data.data.find((p) => p.id === partyId);
  assert.ok(party, "the test party must be present in the list");
  assert.ok(party.totalContainers >= 1);
  assert.equal(party.totalContainers, party.activeContainers + party.clearedContainers);
});

test("reports support party and search filters", async () => {
  const byParty = await get(`/reports/storage?party_id=${partyId}`, adminToken);
  assert.equal(byParty.status, 200);
  assert.ok(byParty.data.data.every((r) => r.party_id === partyId));

  const bySearch = await get(`/reports/storage?search=CONT-EDIT`, adminToken);
  assert.equal(bySearch.status, 200);
  assert.ok(bySearch.data.data.some((r) => r.container_number === "CONT-EDIT"));
  assert.ok(bySearch.data.data.every((r) => r.container_number.includes("CONT-EDIT") || r.party_name.includes("CONT-EDIT")));
});

test("editing a loading record recalculates container totals from full history", async () => {
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-LOADEDIT", date_of_unloading: "2026-01-01", initial_packets: 100, rent_type: "Daily", rent_rate: 50 },
    adminToken
  );
  const cid = c.data.data.id;
  const l1 = await post("/loading", { container_id: cid, date_of_loading: "2026-01-05", packets_loaded: 30 }, adminToken);
  await post("/loading", { container_id: cid, date_of_loading: "2026-01-10", packets_loaded: 20 }, adminToken);

  let detail = await get(`/containers/${cid}`, adminToken);
  assert.equal(detail.data.data.loaded_packets, 50);
  assert.equal(detail.data.data.remaining_packets, 50);

  // Correct the first entry's quantity from 30 -> 45; total should become 65, remaining 35.
  const edited = await put(`/loading/${l1.data.data.log.id}`, { date_of_loading: "2026-01-05", packets_loaded: 45, vehicle_number: "TRK-9", driver_number: "", description: "" }, adminToken);
  assert.equal(edited.status, 200);
  assert.equal(edited.data.data.container.loaded_packets, 65);
  assert.equal(edited.data.data.container.initial_packets - edited.data.data.container.loaded_packets, 35);

  detail = await get(`/containers/${cid}`, adminToken);
  assert.equal(detail.data.data.remaining_packets, 35);
  assert.equal(detail.data.data.status, "Active");
});

test("editing a loading record cannot push total loaded above the container's initial bundles", async () => {
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-LOADCAP", date_of_unloading: "2026-01-01", initial_packets: 50, rent_type: "Daily", rent_rate: 50 },
    adminToken
  );
  const cid = c.data.data.id;
  const l1 = await post("/loading", { container_id: cid, date_of_loading: "2026-01-05", packets_loaded: 20 }, adminToken);
  await post("/loading", { container_id: cid, date_of_loading: "2026-01-10", packets_loaded: 20 }, adminToken);

  // Other log already accounts for 20; raising this one to 40 would total 60 > 50 initial.
  const overEdit = await put(`/loading/${l1.data.data.log.id}`, { date_of_loading: "2026-01-05", packets_loaded: 40, vehicle_number: "", driver_number: "", description: "" }, adminToken);
  assert.equal(overEdit.status, 400);
  assert.match(overEdit.data.message, /exceed/i);
});

test("editing a loading record can un-clear a container that was fully loaded out", async () => {
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-UNCLEAR", date_of_unloading: "2026-01-01", initial_packets: 30, rent_type: "Daily", rent_rate: 50 },
    adminToken
  );
  const cid = c.data.data.id;
  const l1 = await post("/loading", { container_id: cid, date_of_loading: "2026-01-05", packets_loaded: 30 }, adminToken);

  let detail = await get(`/containers/${cid}`, adminToken);
  assert.equal(detail.data.data.status, "Cleared");

  // Correcting the quantity down means it's no longer fully cleared.
  await put(`/loading/${l1.data.data.log.id}`, { date_of_loading: "2026-01-05", packets_loaded: 20, vehicle_number: "", driver_number: "", description: "" }, adminToken);

  detail = await get(`/containers/${cid}`, adminToken);
  assert.equal(detail.data.data.status, "Active");
  assert.equal(detail.data.data.remaining_packets, 10);
});

test("billing status: red 'already billed' for an unpaid invoice, green once payment clears, and re-billing is blocked either way", async () => {
  // Use a dynamic "N days ago" unloading date so billing exactly N days
  // lands the invoice's billing_end on today's real date, regardless of
  // when this test suite happens to run.
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const unloadDate = daysAgo(5);

  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: partyId, container_number: "CONT-STATUS", date_of_unloading: unloadDate, initial_packets: 20, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const cid = c.data.data.id;
  const inv = await post("/invoices", { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: cid, billable_days: 5 }] }, adminToken);

  // Billed exactly up through today: no new days accrued yet — should show as "already billed" and unpaid (red).
  let eligible = await get(`/invoices/eligible-containers?party_id=${partyId}&warehouse_id=${wh1Id}`, adminToken);
  let entry = eligible.data.data.find((x) => x.id === cid);
  assert.equal(entry.alreadyBilled, true);
  assert.equal(entry.billedUnpaid, true);
  assert.equal(entry.billedAndCleared, false);

  // Trying to bill it again for 0 new days should be rejected server-side too (defense in depth).
  const reBill = await post("/invoices", { party_id: partyId, warehouse_id: wh1Id, lines: [{ container_id: cid, billable_days: 0 }] }, adminToken);
  assert.equal(reBill.status, 409);

  // Now fully pay the invoice — status should flip to "billed and cleared" (green).
  await post("/payments", { invoice_id: inv.data.data.id, amount: inv.data.data.subtotal, payment_date: new Date().toISOString().slice(0, 10) }, adminToken);
  eligible = await get(`/invoices/eligible-containers?party_id=${partyId}&warehouse_id=${wh1Id}`, adminToken);
  entry = eligible.data.data.find((x) => x.id === cid);
  assert.equal(entry.alreadyBilled, true);
  assert.equal(entry.billedUnpaid, false);
  assert.equal(entry.billedAndCleared, true);
});

// ---------------------------------------------------------------------------
// PARTY PORTAL
// ---------------------------------------------------------------------------
async function del(url, token) {
  const res = await fetch(baseUrl + url, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, data: await res.json() };
}

test("party portal: generating access creates working, scoped credentials valid 24h", async () => {
  const portalParty = await post("/parties", { party_name: "Portal Test Party", phone: "03001234567" }, adminToken);
  const portalPartyId = portalParty.data.data.id;
  const c = await post(
    "/containers",
    { warehouse_id: wh1Id, party_id: portalPartyId, container_number: "CONT-PORTAL-1", date_of_unloading: "2026-01-01", initial_packets: 40, rent_type: "Daily", rent_rate: 100 },
    adminToken
  );
  const inv = await post("/invoices", { party_id: portalPartyId, warehouse_id: wh1Id, lines: [{ container_id: c.data.data.id, billable_days: 10 }] }, adminToken);

  // Only admins/managers can generate access.
  const forbidden = await post(`/party-portal/${portalPartyId}/generate`, {}, staffToken);
  assert.equal(forbidden.status, 403);

  const generated = await post(`/party-portal/${portalPartyId}/generate`, {}, adminToken);
  assert.equal(generated.status, 201);
  assert.ok(generated.data.data.username);
  assert.ok(generated.data.data.password);
  assert.ok(generated.data.data.token);
  assert.ok(generated.data.data.link.includes(generated.data.data.token));
  assert.ok(generated.data.data.whatsappUrl.startsWith("https://wa.me/"));

  // Expiry should be ~24 hours out.
  const hoursUntilExpiry = (new Date(generated.data.data.expiresAt).getTime() - Date.now()) / 3600000;
  assert.ok(hoursUntilExpiry > 23.9 && hoursUntilExpiry < 24.1, `expected ~24h expiry, got ${hoursUntilExpiry}h`);

  // Login with the generated credentials works.
  const login = await post("/party-portal/login", { username: generated.data.data.username, password: generated.data.data.password });
  assert.equal(login.status, 200);
  assert.ok(login.data.data.token);

  // The magic link itself also works, independent of username/password.
  const verify = await get(`/party-portal/verify/${generated.data.data.token}`);
  assert.equal(verify.status, 200);
  const portalToken = verify.data.data.token;

  // The portal token can fetch this party's own full history...
  const me = await get("/party-portal/me", portalToken);
  assert.equal(me.status, 200);
  assert.equal(me.data.data.party.id, portalPartyId);
  assert.equal(me.data.data.totalContainers, 1);
  assert.equal(me.data.data.invoices.length, 1);
  assert.equal(me.data.data.invoices[0].items.length, 1);

  // ...but a portal token must NEVER work against the main admin API.
  const crossUse = await get(`/containers/${c.data.data.id}`, portalToken);
  assert.equal(crossUse.status, 401);

  // Wrong password is rejected.
  const badLogin = await post("/party-portal/login", { username: generated.data.data.username, password: "wrongpassword" });
  assert.equal(badLogin.status, 401);
});

test("party portal: revoking access immediately cuts off the portal token, even before it expires", async () => {
  const portalParty = await post("/parties", { party_name: "Revoke Test Party" }, adminToken);
  const portalPartyId = portalParty.data.data.id;
  const generated = await post(`/party-portal/${portalPartyId}/generate`, {}, adminToken);
  const verify = await get(`/party-portal/verify/${generated.data.data.token}`);
  const portalToken = verify.data.data.token;

  const meBefore = await get("/party-portal/me", portalToken);
  assert.equal(meBefore.status, 200);

  const revoke = await post(`/party-portal/${portalPartyId}/revoke`, {}, adminToken);
  assert.equal(revoke.status, 200);

  // Same still-unexpired JWT must now be rejected because the underlying grant is revoked.
  const meAfter = await get("/party-portal/me", portalToken);
  assert.equal(meAfter.status, 401);

  // The magic link itself is also dead now.
  const verifyAfter = await get(`/party-portal/verify/${generated.data.data.token}`);
  assert.equal(verifyAfter.status, 404);
});

test("party portal: generating new access for the same party invalidates the previous grant", async () => {
  const portalParty = await post("/parties", { party_name: "Regenerate Test Party" }, adminToken);
  const portalPartyId = portalParty.data.data.id;
  const first = await post(`/party-portal/${portalPartyId}/generate`, {}, adminToken);
  const second = await post(`/party-portal/${portalPartyId}/generate`, {}, adminToken);

  const oldLogin = await post("/party-portal/login", { username: first.data.data.username, password: first.data.data.password });
  assert.equal(oldLogin.status, 401, "the previous grant's username should no longer authenticate once superseded");

  const newLogin = await post("/party-portal/login", { username: second.data.data.username, password: second.data.data.password });
  assert.equal(newLogin.status, 200);
});

test("party portal: the management list shows access status per party", async () => {
  const portalParty = await post("/parties", { party_name: "List Status Party" }, adminToken);
  const portalPartyId = portalParty.data.data.id;

  let list = await get("/party-portal", adminToken);
  assert.equal(list.status, 200);
  let entry = list.data.data.find((p) => p.party_id === portalPartyId);
  assert.equal(entry.access, null);

  await post(`/party-portal/${portalPartyId}/generate`, {}, adminToken);
  list = await get("/party-portal", adminToken);
  entry = list.data.data.find((p) => p.party_id === portalPartyId);
  assert.equal(entry.access.status, "active");

  await post(`/party-portal/${portalPartyId}/revoke`, {}, adminToken);
  list = await get("/party-portal", adminToken);
  entry = list.data.data.find((p) => p.party_id === portalPartyId);
  assert.equal(entry.access.status, "revoked");
});
