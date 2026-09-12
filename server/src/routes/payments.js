import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { notifyPaymentReceived } from "../services/notifications.js";
import { round2 } from "../services/billing.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { invoice_id, party_id, warehouse_id } = req.query;
    let sql = `SELECT pay.*, i.invoice_number FROM payments pay JOIN invoices i ON i.id = pay.invoice_id WHERE 1=1`;
    const params = [];
    if (warehouse_id) {
      if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(warehouse_id)) {
        return fail(res, "You do not have permission to access this warehouse.", 403);
      }
      sql += " AND pay.warehouse_id = ?";
      params.push(warehouse_id);
    } else if (req.user.role !== "SUPER_ADMIN") {
      // No specific warehouse requested — never fall through to "all
      // payments system-wide" for a non-admin; scope to what they can see.
      if (!req.userWarehouseIds.length) return ok(res, []);
      sql += ` AND pay.warehouse_id IN (${req.userWarehouseIds.map(() => "?").join(",")})`;
      params.push(...req.userWarehouseIds);
    }
    if (invoice_id) {
      sql += " AND pay.invoice_id = ?";
      params.push(invoice_id);
    }
    if (party_id) {
      sql += " AND pay.party_id = ?";
      params.push(party_id);
    }
    sql += " ORDER BY pay.payment_date DESC";
    ok(res, db.prepare(sql).all(...params));
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { invoice_id, amount, payment_date, payment_method, reference, notes } = req.body;
    const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoice_id);
    if (!invoice) return fail(res, "Invoice not found.", 400);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(invoice.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    if (invoice.status === "Cancelled") return fail(res, "Cannot record a payment against a cancelled invoice.", 400);

    const amt = +amount;
    if (!Number.isFinite(amt) || amt <= 0) return fail(res, "Please enter a valid payment amount.", 400);
    if (amt > invoice.balance + 0.01) return fail(res, `Payment cannot exceed the remaining balance (Rs. ${invoice.balance}).`, 400);

    const id = nanoid();
    const txn = db.transaction(() => {
      db.prepare(
        `INSERT INTO payments (id, invoice_id, party_id, warehouse_id, amount, payment_date, payment_method, reference, notes, received_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, invoice_id, invoice.party_id, invoice.warehouse_id, amt, payment_date || new Date().toISOString().slice(0, 10), payment_method || "Cash", reference || "", notes || "", req.user.id);

      const newPaid = round2(invoice.paid_amount + amt);
      const newBalance = round2(invoice.subtotal - newPaid);
      const newStatus = newBalance <= 0 ? "Paid" : "Partially Paid";
      db.prepare("UPDATE invoices SET paid_amount=?, balance=?, status=?, updated_at=datetime('now') WHERE id=?").run(
        newPaid,
        Math.max(newBalance, 0),
        newStatus,
        invoice_id
      );
    });
    txn();

    logAudit({
      user: req.user,
      action: "Recorded payment",
      entity: "payment",
      entityId: id,
      warehouseId: invoice.warehouse_id,
      details: { invoice_number: invoice.invoice_number, amount: amt },
    });

    const payment = db.prepare("SELECT * FROM payments WHERE id=?").get(id);
    const updatedInvoice = db.prepare("SELECT * FROM invoices WHERE id=?").get(invoice_id);
    notifyPaymentReceived(payment, updatedInvoice, req.user.id);

    ok(res, { payment, invoice: updatedInvoice }, 201);
  })
);

/**
 * Undo a payment. If it was a manually recorded cash/bank/other payment,
 * this simply reverses the invoice's paid_amount/balance/status. If it was
 * an auto-applied "Credit Note" payment (from the banked-adjustment flow),
 * this also refunds the amount back to the originating credit note's
 * available balance and removes the credit_applications link — so undoing
 * an auto-applied credit correctly makes it available again for the next
 * bill, exactly as if it had never been used.
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
    if (!payment) return fail(res, "Payment not found.", 404);
    const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(payment.invoice_id);
    if (!invoice) return fail(res, "Invoice not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(payment.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }

    const txn = db.transaction(() => {
      db.prepare("DELETE FROM payments WHERE id = ?").run(payment.id);

      const newPaid = Math.max(round2(invoice.paid_amount - payment.amount), 0);
      const newBalance = round2(invoice.subtotal - newPaid);
      const newStatus = newBalance <= 0 ? "Paid" : newPaid > 0 ? "Partially Paid" : "Generated";
      db.prepare("UPDATE invoices SET paid_amount=?, balance=?, status=?, updated_at=datetime('now') WHERE id=?").run(newPaid, newBalance, newStatus, invoice.id);

      if (payment.payment_method === "Credit Note") {
        const application = db.prepare("SELECT * FROM credit_applications WHERE payment_id = ?").get(payment.id);
        if (application) {
          db.prepare("UPDATE invoices SET credit_remaining = credit_remaining + ?, updated_at = datetime('now') WHERE id = ?").run(
            application.amount,
            application.credit_note_id
          );
          db.prepare("DELETE FROM credit_applications WHERE id = ?").run(application.id);
        }
      }
    });
    txn();

    logAudit({
      user: req.user,
      action: "Undid payment",
      entity: "payment",
      entityId: payment.id,
      warehouseId: payment.warehouse_id,
      details: { invoice_number: invoice.invoice_number, amount: payment.amount },
    });

    ok(res, { invoice: db.prepare("SELECT * FROM invoices WHERE id=?").get(invoice.id) });
  })
);

export default router;
