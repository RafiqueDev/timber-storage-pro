import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { calculateContainerRent, defaultBillableDays } from "../services/billing.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, status, warehouse_id } = req.query;
    // Single aggregate query instead of N+1 per-party lookups, so the list
    // page can show each party's container counts side-by-side without a
    // separate round trip per card.
    let sql = `
      SELECT p.*,
        COUNT(c.id) AS totalContainers,
        SUM(CASE WHEN c.status = 'Active' THEN 1 ELSE 0 END) AS activeContainers,
        SUM(CASE WHEN c.status = 'Cleared' THEN 1 ELSE 0 END) AS clearedContainers
      FROM parties p
      LEFT JOIN containers c ON c.party_id = p.id ${warehouse_id ? "AND c.warehouse_id = ?" : ""}
      WHERE 1=1
    `;
    const params = [];
    if (warehouse_id) params.push(warehouse_id);
    if (search) {
      sql += " AND p.party_name LIKE ?";
      params.push(`%${search}%`);
    }
    if (status) {
      sql += " AND p.status = ?";
      params.push(status);
    }
    sql += " GROUP BY p.id ORDER BY p.party_name";
    const rows = db.prepare(sql).all(...params);
    ok(
      res,
      rows.map((r) => ({
        ...r,
        totalContainers: r.totalContainers || 0,
        activeContainers: r.activeContainers || 0,
        clearedContainers: r.clearedContainers || 0,
      }))
    );
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(req.params.id);
    if (!party) return fail(res, "Party not found.", 404);

    const containers = db.prepare("SELECT * FROM containers WHERE party_id = ?").all(party.id);
    const today = new Date().toISOString().slice(0, 10);
    const activeContainers = containers.filter((c) => c.status === "Active");
    const accruedRent = activeContainers.reduce((sum, c) => {
      const days = defaultBillableDays(c.date_of_unloading, today);
      return sum + calculateContainerRent({ rentType: c.rent_type, rentRate: c.rent_rate, billableDays: days });
    }, 0);

    const invoices = db.prepare("SELECT * FROM invoices WHERE party_id = ? ORDER BY invoice_date DESC").all(party.id);
    const outstanding = invoices.reduce((sum, inv) => sum + inv.balance, 0);
    // Banked credit from Issue Adjustment that hasn't been used on a bill
    // yet — shown separately from "outstanding" since it doesn't reduce
    // what's currently owed, only what the NEXT bill will come to.
    const availableCredit =
      db
        .prepare("SELECT COALESCE(SUM(credit_remaining),0) s FROM invoices WHERE party_id = ? AND type = 'CreditNote' AND status != 'Cancelled'")
        .get(party.id).s || 0;

    ok(res, {
      ...party,
      totalContainers: containers.length,
      activeContainers: activeContainers.length,
      clearedContainers: containers.filter((c) => c.status === "Cleared").length,
      totalStoredBundles: activeContainers.reduce((s, c) => s + (c.initial_packets - c.loaded_packets), 0),
      totalLoadedBundles: containers.reduce((s, c) => s + c.loaded_packets, 0),
      accruedRent,
      outstandingBalance: outstanding,
      availableCredit,
      recentInvoices: invoices.slice(0, 5),
    });
  })
);

router.get(
  "/:id/statement",
  asyncHandler(async (req, res) => {
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(req.params.id);
    if (!party) return fail(res, "Party not found.", 404);
    const { warehouse_id, start, end } = req.query;

    let invSql = "SELECT * FROM invoices WHERE party_id = ?";
    const invParams = [party.id];
    if (warehouse_id) {
      invSql += " AND warehouse_id = ?";
      invParams.push(warehouse_id);
    }
    if (start) {
      invSql += " AND invoice_date >= ?";
      invParams.push(start);
    }
    if (end) {
      invSql += " AND invoice_date <= ?";
      invParams.push(end);
    }
    const invoices = db.prepare(invSql + " ORDER BY invoice_date").all(...invParams);

    const invoiceIds = invoices.map((i) => i.id);
    let payments = [];
    if (invoiceIds.length) {
      const placeholders = invoiceIds.map(() => "?").join(",");
      payments = db
        .prepare(`SELECT * FROM payments WHERE invoice_id IN (${placeholders}) ORDER BY payment_date`)
        .all(...invoiceIds);
    }

    const entries = [
      ...invoices.map((i) => ({ type: "invoice", date: i.invoice_date, ref: i.invoice_number, amount: i.subtotal, id: i.id })),
      ...payments.map((p) => ({ type: "payment", date: p.payment_date, ref: p.reference || p.payment_method, amount: -p.amount, id: p.id })),
    ].sort((a, b) => (a.date > b.date ? 1 : -1));

    const outstanding = invoices.reduce((s, i) => s + i.balance, 0);
    ok(res, { party, entries, outstanding });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { party_name, contact_person, phone, alternate_phone, address, notes } = req.body;
    if (!party_name?.trim()) return fail(res, "Party name is required.", 400);
    const id = nanoid();
    db.prepare(
      `INSERT INTO parties (id, party_name, contact_person, phone, alternate_phone, address, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, party_name.trim(), contact_person || "", phone || "", alternate_phone || "", address || "", notes || "");
    logAudit({ user: req.user, action: "Created party", entity: "party", entityId: id, details: { party_name } });
    ok(res, db.prepare("SELECT * FROM parties WHERE id=?").get(id), 201);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const p = db.prepare("SELECT * FROM parties WHERE id = ?").get(req.params.id);
    if (!p) return fail(res, "Party not found.", 404);
    const { party_name, contact_person, phone, alternate_phone, address, notes, status } = req.body;
    db.prepare(
      `UPDATE parties SET party_name=?, contact_person=?, phone=?, alternate_phone=?, address=?, notes=?, status=?, updated_at=datetime('now') WHERE id=?`
    ).run(
      party_name ?? p.party_name,
      contact_person ?? p.contact_person,
      phone ?? p.phone,
      alternate_phone ?? p.alternate_phone,
      address ?? p.address,
      notes ?? p.notes,
      status ?? p.status,
      p.id
    );
    logAudit({ user: req.user, action: "Updated party", entity: "party", entityId: p.id });
    ok(res, db.prepare("SELECT * FROM parties WHERE id=?").get(p.id));
  })
);

/**
 * Undo a party that was just created by mistake. Only allowed while it has
 * zero containers ever assigned to it, so this can never quietly erase a
 * party with real history.
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const p = db.prepare("SELECT * FROM parties WHERE id = ?").get(req.params.id);
    if (!p) return fail(res, "Party not found.", 404);
    const containerCount = db.prepare("SELECT COUNT(*) c FROM containers WHERE party_id = ?").get(p.id).c;
    if (containerCount > 0) {
      return fail(res, "This party already has containers assigned, so it can no longer be undone.", 400);
    }
    db.prepare("DELETE FROM parties WHERE id = ?").run(p.id);
    logAudit({ user: req.user, action: "Undid party", entity: "party", entityId: p.id, details: { party_name: p.party_name } });
    ok(res, { deleted: true });
  })
);

export default router;
