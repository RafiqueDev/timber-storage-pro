import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { notifyInvoiceGenerated } from "../services/notifications.js";
import { calculateContainerRent, billingReferenceDate, daysBetween, breakdownDuration, round2 } from "../services/billing.js";

const router = Router();
router.use(authenticate);

function nextDocumentNumber(companyId, prefixOverride) {
  const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId);
  const seq = company.next_invoice_seq;
  const year = new Date().getFullYear();
  const prefix = prefixOverride || company.invoice_prefix;
  const number = `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
  db.prepare("UPDATE companies SET next_invoice_seq = next_invoice_seq + 1 WHERE id = ?").run(companyId);
  return number;
}

/**
 * Containers eligible for billing for a given party (spec #34), extended so
 * containers that have already been fully loaded out (status = Cleared)
 * still show up here for their final billing period instead of vanishing
 * the moment they hit zero remaining stock. The billable period for a
 * cleared container is capped at its last loading date rather than today,
 * since it stopped accruing storage rent the moment it was emptied.
 */
router.get(
  "/eligible-containers",
  asyncHandler(async (req, res) => {
    const { party_id, warehouse_id } = req.query;
    if (!party_id) return fail(res, "party_id is required.", 400);
    const party = db.prepare("SELECT id, company_id FROM parties WHERE id = ?").get(party_id);
    if (!party || party.company_id !== req.companyId) return fail(res, "Party not found.", 404);
    if (warehouse_id && req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    let sql = "SELECT * FROM containers WHERE company_id = ? AND party_id = ? AND status IN ('Active','Cleared')";
    const params = [req.companyId, party_id];
    if (warehouse_id) {
      sql += " AND warehouse_id = ?";
      params.push(warehouse_id);
    } else if (req.user.role !== "SUPER_ADMIN") {
      // No specific warehouse requested — restrict to the ones this user can
      // actually see, rather than leaking containers from every warehouse.
      if (!req.userWarehouseIds.length) return ok(res, []);
      sql += ` AND warehouse_id IN (${req.userWarehouseIds.map(() => "?").join(",")})`;
      params.push(...req.userWarehouseIds);
    }
    sql += " ORDER BY status ASC, date_of_unloading DESC";
    const containers = db.prepare(sql).all(...params);
    const today = new Date().toISOString().slice(0, 10);
    ok(
      res,
      containers.map((c) => {
        // Pull both the item AND its parent invoice's payment status in one
        // go, so the Billing screen can show whether the most recent
        // invoice for this container is still outstanding or fully paid.
        const lastInvoiceItem = db
          .prepare(
            `SELECT ii.*, i.invoice_date, i.balance AS invoice_balance, i.status AS invoice_status, i.invoice_number
             FROM invoice_items ii
             JOIN invoices i ON i.id = ii.invoice_id
             WHERE ii.container_id = ? AND i.status != 'Cancelled'
             ORDER BY ii.billing_end DESC LIMIT 1`
          )
          .get(c.id);
        const periodStart = lastInvoiceItem ? lastInvoiceItem.billing_end : c.date_of_unloading;
        const referenceEnd = billingReferenceDate(c, today);
        const defaultDays = daysBetween(periodStart, referenceEnd);
        const { months, remainingDays } = breakdownDuration(defaultDays);

        // "Already billed" = there IS a prior invoice AND no new days have
        // accrued since it was generated — genuinely nothing new to charge.
        // A brand-new container with no prior invoice is NOT this (must
        // stay selectable so it can still be billed for the first time).
        // The moment new days accrue again (time passes on an Active
        // container), this clears itself automatically and billing reopens.
        const alreadyBilled = !!lastInvoiceItem && defaultDays <= 0;
        const billedAndCleared = alreadyBilled && lastInvoiceItem.invoice_balance <= 0;
        const billedUnpaid = alreadyBilled && lastInvoiceItem.invoice_balance > 0;

        return {
          ...c,
          remainingBundles: c.initial_packets - c.loaded_packets,
          periodStart,
          referenceEnd,
          defaultDays,
          roundDownMonthsDays: months * 30,
          exactBreakdown: { months, remainingDays },
          lastBilledDate: lastInvoiceItem?.billing_end || null,
          lastInvoiceNumber: lastInvoiceItem?.invoice_number || null,
          lastInvoiceBalance: lastInvoiceItem?.invoice_balance ?? null,
          alreadyBilled,
          billedAndCleared,
          billedUnpaid,
          // Deprecated alias kept for anything still reading the old name.
          fullyBilled: alreadyBilled,
        };
      })
    );
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { warehouse_id, party_id, status, search } = req.query;
    let sql = `SELECT i.*, p.party_name, w.branch_name FROM invoices i
               JOIN parties p ON p.id = i.party_id
               JOIN warehouses w ON w.id = i.warehouse_id WHERE i.company_id = ?`;
    const params = [req.companyId];
    if (warehouse_id) {
      sql += " AND i.warehouse_id = ?";
      params.push(warehouse_id);
    } else if (req.user.role !== "SUPER_ADMIN") {
      if (!req.userWarehouseIds.length) return ok(res, []);
      sql += ` AND i.warehouse_id IN (${req.userWarehouseIds.map(() => "?").join(",")})`;
      params.push(...req.userWarehouseIds);
    }
    if (party_id) {
      sql += " AND i.party_id = ?";
      params.push(party_id);
    }
    if (status) {
      sql += " AND i.status = ?";
      params.push(status);
    }
    if (search) {
      sql += " AND (i.invoice_number LIKE ? OR p.party_name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += " ORDER BY i.invoice_date DESC";
    ok(res, db.prepare(sql).all(...params));
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!inv || inv.company_id !== req.companyId) return fail(res, "Invoice not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(inv.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(inv.party_id);
    const warehouse = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(inv.warehouse_id);
    const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id);
    const payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date").all(inv.id);
    const adjustments = db.prepare("SELECT * FROM invoices WHERE adjustment_for = ? ORDER BY invoice_date").all(inv.id);
    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(req.companyId);
    ok(res, {
      ...inv,
      party,
      warehouse,
      items,
      payments,
      adjustments,
      company,
      // Editable only while nothing has been paid against it yet — once a
      // payment exists the invoice's numbers are locked and corrections
      // must go through the adjustment/credit-note workflow instead, so a
      // partial payment can never be left referencing an amount that no
      // longer exists.
      editable: inv.type !== "CreditNote" && inv.status !== "Cancelled" && inv.paid_amount === 0,
    });
  })
);

/**
 * Edit an unpaid invoice's billable days per line item (spec-driven request:
 * invoices should be correctable before any payment has been collected,
 * without going through the heavier credit-note flow). Recalculates every
 * line through the same central billing engine used at generation time, so
 * edited numbers are exactly as trustworthy as newly-generated ones.
 */
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!inv || inv.company_id !== req.companyId) return fail(res, "Invoice not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(inv.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    if (inv.type === "CreditNote") return fail(res, "Credit notes cannot be edited.", 400);
    if (inv.status === "Cancelled") return fail(res, "A cancelled invoice cannot be edited.", 400);
    if (inv.paid_amount > 0) {
      return fail(res, "This invoice already has payments recorded, so it can no longer be edited — use Issue Adjustment instead.", 400);
    }

    const { invoice_date, items } = req.body; // items: [{ id, billable_days }]
    if (!Array.isArray(items) || items.length === 0) return fail(res, "At least one line item is required.", 400);

    const existingItems = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id);
    const byId = new Map(existingItems.map((i) => [i.id, i]));

    let subtotal = 0;
    let periodStartMin = null;
    let periodEndMax = null;
    const updates = [];

    for (const line of items) {
      const existing = byId.get(line.id);
      if (!existing) return fail(res, "One or more line items do not belong to this invoice.", 400);
      const days = +line.billable_days;
      if (!Number.isFinite(days) || days < 0) return fail(res, "Billable days cannot be negative.", 400);

      const rent = calculateContainerRent({ rentType: existing.rent_type, rentRate: existing.rent_rate, billableDays: days });
      const billingEnd = new Date(new Date(existing.billing_start + "T00:00:00").getTime() + days * 86400000).toISOString().slice(0, 10);
      subtotal = round2(subtotal + rent);
      if (!periodStartMin || existing.billing_start < periodStartMin) periodStartMin = existing.billing_start;
      if (!periodEndMax || billingEnd > periodEndMax) periodEndMax = billingEnd;

      updates.push({ id: existing.id, days, billingEnd, rent });
    }

    const txn = db.transaction(() => {
      for (const u of updates) {
        db.prepare("UPDATE invoice_items SET billable_days = ?, billing_end = ?, calculated_rent = ? WHERE id = ?").run(
          u.days,
          u.billingEnd,
          u.rent,
          u.id
        );
      }
      db.prepare(
        `UPDATE invoices SET invoice_date = ?, billing_period_start = ?, billing_period_end = ?, subtotal = ?, balance = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(invoice_date || inv.invoice_date, periodStartMin, periodEndMax, subtotal, subtotal, inv.id);
    });
    txn();

    logAudit({
      user: req.user,
      action: "Edited invoice",
      entity: "invoice",
      entityId: inv.id,
      warehouseId: inv.warehouse_id,
      details: { invoiceNumber: inv.invoice_number, newSubtotal: subtotal },
    });

    const updatedInvoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(inv.id);
    const updatedItems = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id);
    ok(res, { ...updatedInvoice, items: updatedItems });
  })
);

/**
 * Generate invoice. Backend re-validates + recalculates everything server-side
 * (spec #129) — never trusts the client's totals, only the container ids and
 * the user-adjusted billable days per container. Works for both Active and
 * Cleared containers so a finished container's final period can still be billed.
 */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { warehouse_id, party_id, invoice_date, lines } = req.body; // lines: [{container_id, billable_days}]
    if (!warehouse_id || !party_id) return fail(res, "Warehouse and party are required.", 400);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const warehouse = db.prepare("SELECT id, company_id FROM warehouses WHERE id = ?").get(warehouse_id);
    if (!warehouse || warehouse.company_id !== req.companyId) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const party = db.prepare("SELECT id, company_id FROM parties WHERE id = ?").get(party_id);
    if (!party || party.company_id !== req.companyId) return fail(res, "Party not found.", 404);
    if (!Array.isArray(lines) || lines.length === 0) return fail(res, "Select at least one container to bill.", 400);

    const today = new Date().toISOString().slice(0, 10);
    const invDate = invoice_date || today;

    const items = [];
    let subtotal = 0;
    let periodStartMin = null;
    let periodEndMax = null;

    for (const line of lines) {
      const c = db.prepare("SELECT * FROM containers WHERE id = ?").get(line.container_id);
      if (!c || c.company_id !== req.companyId || c.party_id !== party_id || c.warehouse_id !== warehouse_id) {
        return fail(res, "One or more selected containers are invalid for this party/warehouse.", 400);
      }
      const referenceEnd = billingReferenceDate(c, today);
      const days = Number.isFinite(+line.billable_days) ? +line.billable_days : daysBetween(c.date_of_unloading, referenceEnd);
      if (days < 0) return fail(res, "Billable days cannot be negative.", 400);

      const lastInvoiceItem = db
        .prepare(
          `SELECT ii.* FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
           WHERE ii.container_id = ? AND i.status != 'Cancelled' ORDER BY ii.billing_end DESC LIMIT 1`
        )
        .get(c.id);
      const periodStart = lastInvoiceItem ? lastInvoiceItem.billing_end : c.date_of_unloading;
      // Prevent accidental duplicate billing for the exact same period (spec #33).
      if (lastInvoiceItem && lastInvoiceItem.billing_end >= referenceEnd && days === 0) {
        return fail(res, `Container ${c.container_number} has already been billed up to its final period.`, 409);
      }
      const periodEnd = new Date(new Date(periodStart + "T00:00:00").getTime() + days * 86400000)
        .toISOString()
        .slice(0, 10);

      const rent = calculateContainerRent({ rentType: c.rent_type, rentRate: c.rent_rate, billableDays: days });
      subtotal = round2(subtotal + rent);

      items.push({
        container_id: c.id,
        container_number: c.container_number,
        arrival_date: c.date_of_unloading,
        billing_start: periodStart,
        billing_end: periodEnd,
        billable_days: days,
        rent_type: c.rent_type,
        rent_rate: c.rent_rate,
        calculated_rent: rent,
      });
      if (!periodStartMin || periodStart < periodStartMin) periodStartMin = periodStart;
      if (!periodEndMax || periodEnd > periodEndMax) periodEndMax = periodEnd;
    }

    const invoiceId = nanoid();
    const invoiceNumber = nextDocumentNumber(req.companyId);

    const txn = db.transaction(() => {
      db.prepare(
        `INSERT INTO invoices (id, company_id, invoice_number, warehouse_id, party_id, invoice_date, billing_period_start, billing_period_end, subtotal, paid_amount, balance, status, type, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Generated', 'Invoice', ?)`
      ).run(invoiceId, req.companyId, invoiceNumber, warehouse_id, party_id, invDate, periodStartMin, periodEndMax, subtotal, subtotal, req.user.id);

      for (const item of items) {
        db.prepare(
          `INSERT INTO invoice_items (id, invoice_id, container_id, container_number, arrival_date, billing_start, billing_end, billable_days, rent_type, rent_rate, calculated_rent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          nanoid(),
          invoiceId,
          item.container_id,
          item.container_number,
          item.arrival_date,
          item.billing_start,
          item.billing_end,
          item.billable_days,
          item.rent_type,
          item.rent_rate,
          item.calculated_rent
        );
      }

      // Automatically apply any banked credit from prior "Issue Adjustment"
      // credit notes for this party — this is the whole point of banking
      // credit instead of netting it immediately: it sits unused until the
      // party's NEXT bill, then reduces what's owed on it, oldest credit
      // first, applied like a payment so status/balance logic stays unified.
      // Scoped to company_id too, even though party_id alone would already
      // be company-unique — belt and suspenders on the tenant boundary.
      if (subtotal > 0) {
        const availableCredits = db
          .prepare(
            `SELECT * FROM invoices WHERE company_id = ? AND party_id = ? AND type = 'CreditNote' AND status != 'Cancelled' AND credit_remaining > 0
             ORDER BY invoice_date ASC, created_at ASC`
          )
          .all(req.companyId, party_id);

        let remainingToCover = subtotal;
        let totalApplied = 0;
        for (const credit of availableCredits) {
          if (remainingToCover <= 0) break;
          const applyAmount = round2(Math.min(credit.credit_remaining, remainingToCover));
          if (applyAmount <= 0) continue;

          const paymentId = nanoid();
          db.prepare(
            `INSERT INTO payments (id, company_id, invoice_id, party_id, warehouse_id, amount, payment_date, payment_method, reference, notes, received_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'Credit Note', ?, ?, ?)`
          ).run(paymentId, req.companyId, invoiceId, party_id, warehouse_id, applyAmount, invDate, credit.invoice_number, `Auto-applied banked credit from ${credit.invoice_number}`, req.user.id);

          db.prepare(`UPDATE invoices SET credit_remaining = credit_remaining - ?, updated_at = datetime('now') WHERE id = ?`).run(applyAmount, credit.id);
          db.prepare(
            `INSERT INTO credit_applications (id, credit_note_id, invoice_id, payment_id, amount) VALUES (?, ?, ?, ?, ?)`
          ).run(nanoid(), credit.id, invoiceId, paymentId, applyAmount);

          remainingToCover = round2(remainingToCover - applyAmount);
          totalApplied = round2(totalApplied + applyAmount);
        }

        if (totalApplied > 0) {
          const newBalance = Math.max(round2(subtotal - totalApplied), 0);
          const newStatus = newBalance <= 0 ? "Paid" : "Partially Paid";
          db.prepare(`UPDATE invoices SET paid_amount = ?, balance = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
            totalApplied,
            newBalance,
            newStatus,
            invoiceId
          );
        }
      }
    });
    txn();

    logAudit({
      user: req.user,
      action: "Generated invoice",
      entity: "invoice",
      entityId: invoiceId,
      warehouseId: warehouse_id,
      details: { invoiceNumber, subtotal },
    });

    const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
    notifyInvoiceGenerated(invoice, req.user.id);

    const savedItems = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(invoiceId);
    const partyRow = db.prepare("SELECT * FROM parties WHERE id = ?").get(party_id);
    const warehouseRow = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(warehouse_id);
    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(req.companyId);
    ok(res, { ...invoice, items: savedItems, party: partyRow, warehouse: warehouseRow, company }, 201);
  })
);

router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!inv || inv.company_id !== req.companyId) return fail(res, "Invoice not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(inv.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    if (inv.paid_amount > 0) return fail(res, "Cannot cancel an invoice that already has payments recorded. Adjust payments first.", 400);
    db.prepare("UPDATE invoices SET status='Cancelled', updated_at=datetime('now') WHERE id=?").run(inv.id);
    logAudit({ user: req.user, action: "Cancelled invoice", entity: "invoice", entityId: inv.id, warehouseId: inv.warehouse_id });
    ok(res, db.prepare("SELECT * FROM invoices WHERE id=?").get(inv.id));
  })
);

/**
 * Correction workflow (spec #102), redesigned to bank the credit rather than
 * net it immediately: once an invoice is finalized, its stored calculations
 * are never silently rewritten. Issuing an adjustment here creates a linked
 * "Credit Note" that does NOT touch the party's current outstanding balance
 * — instead it sits as available credit (`credit_remaining`) and is
 * automatically applied, oldest-first, the next time this party is billed
 * (see the auto-apply block in POST /invoices above). The original invoice's
 * own numbers stay exactly as they were generated either way — a full,
 * audited paper trail regardless of when the credit actually gets used.
 */
router.post(
  "/:id/adjust",
  asyncHandler(async (req, res) => {
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!inv || inv.company_id !== req.companyId) return fail(res, "Invoice not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(inv.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    if (inv.status === "Cancelled") return fail(res, "Cannot adjust a cancelled invoice.", 400);
    if (inv.type === "CreditNote") return fail(res, "Cannot issue an adjustment against a credit note.", 400);

    const { amount, reason } = req.body;
    const amt = +amount;
    if (!Number.isFinite(amt) || amt <= 0) return fail(res, "Please enter a valid adjustment amount.", 400);
    if (amt > inv.subtotal + 0.01) return fail(res, `Adjustment cannot exceed the original invoice total (Rs. ${inv.subtotal}).`, 400);
    if (!reason?.trim()) return fail(res, "Please provide a reason for this adjustment.", 400);

    const creditNoteId = nanoid();
    const creditNoteNumber = nextDocumentNumber(req.companyId, "CN");
    db.prepare(
      `INSERT INTO invoices (id, company_id, invoice_number, warehouse_id, party_id, invoice_date, billing_period_start, billing_period_end, subtotal, paid_amount, balance, credit_remaining, status, type, adjustment_for, adjustment_reason, created_by)
       VALUES (?, ?, ?, ?, ?, date('now'), ?, ?, ?, 0, 0, ?, 'Generated', 'CreditNote', ?, ?, ?)`
    ).run(
      creditNoteId,
      req.companyId,
      creditNoteNumber,
      inv.warehouse_id,
      inv.party_id,
      inv.billing_period_start,
      inv.billing_period_end,
      -amt,
      amt,
      inv.id,
      reason.trim(),
      req.user.id
    );

    logAudit({
      user: req.user,
      action: "Issued invoice adjustment (banked as credit for next bill)",
      entity: "invoice",
      entityId: creditNoteId,
      warehouseId: inv.warehouse_id,
      details: { against: inv.invoice_number, amount: amt, reason: reason.trim() },
    });

    ok(res, db.prepare("SELECT * FROM invoices WHERE id=?").get(creditNoteId), 201);
  })
);

/**
 * Undo / hard delete. Deliberately conservative: only ever allowed while the
 * record has had zero real-world consequences yet — no payment collected,
 * no credit consumed or applied, and (for a regular invoice) no adjustment
 * issued against it. This is "undo a mistake I just made", not a general
 * rewrite-history tool — anything with money already attached to it goes
 * through Cancel / Issue Adjustment instead, which keep an audit trail.
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!inv || inv.company_id !== req.companyId) return fail(res, "Invoice not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(inv.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }

    if (inv.type === "CreditNote") {
      const originalAmount = Math.abs(inv.subtotal);
      if (round2(inv.credit_remaining) !== round2(originalAmount)) {
        return fail(res, "This credit has already been partly or fully applied to a bill, so it can no longer be undone.", 400);
      }
    } else {
      if (inv.paid_amount > 0) {
        return fail(res, "This invoice has payments (or applied credit) recorded against it, so it can no longer be undone. Use Cancel Invoice instead.", 400);
      }
      const adjustmentCount = db.prepare("SELECT COUNT(*) c FROM invoices WHERE adjustment_for = ?").get(inv.id).c;
      if (adjustmentCount > 0) {
        return fail(res, "An adjustment has already been issued against this invoice, so it can no longer be undone.", 400);
      }
    }

    const txn = db.transaction(() => {
      db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(inv.id);
      db.prepare("DELETE FROM credit_applications WHERE invoice_id = ? OR credit_note_id = ?").run(inv.id, inv.id);
      db.prepare("DELETE FROM invoices WHERE id = ?").run(inv.id);
    });
    txn();

    logAudit({
      user: req.user,
      action: inv.type === "CreditNote" ? "Undid invoice adjustment" : "Undid invoice",
      entity: "invoice",
      entityId: inv.id,
      warehouseId: inv.warehouse_id,
      details: { invoiceNumber: inv.invoice_number },
    });

    ok(res, { deleted: true });
  })
);

export default router;
