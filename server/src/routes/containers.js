import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate, authorizeWarehouse } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { notifyContainerCleared } from "../services/notifications.js";
import { calculateContainerRent, billingReferenceDate, daysBetween, remainingBundles } from "../services/billing.js";

const router = Router();
router.use(authenticate);

function enrich(c, threshold = 25) {
  const today = new Date().toISOString().slice(0, 10);
  const remaining = remainingBundles(c);
  // Cleared containers stop accruing rent at their last loading date, not
  // "today" — otherwise a fully-loaded-out container would appear to keep
  // racking up rent forever after it physically left the warehouse.
  const referenceDate = billingReferenceDate(c, today);
  const days = daysBetween(c.date_of_unloading, referenceDate);
  const accruedRent = calculateContainerRent({ rentType: c.rent_type, rentRate: c.rent_rate, billableDays: days });
  return {
    ...c,
    remaining_packets: remaining,
    default_billable_days: days,
    accrued_rent: accruedRent,
    low_stock: c.status === "Active" && remaining <= threshold,
  };
}

router.get(
  "/",
  authorizeWarehouse((req) => req.query.warehouse_id),
  asyncHandler(async (req, res) => {
    const { warehouse_id, party_id, status, search } = req.query;
    // company_id is always the primary filter, regardless of role — every
    // other condition below only ever narrows further within it. This is a
    // deliberate second layer on top of authorizeWarehouse: even if the
    // warehouse-scoping logic had a bug, a cross-company leak still isn't
    // possible here.
    let sql = "SELECT * FROM containers WHERE company_id = ?";
    const params = [req.companyId];
    if (warehouse_id) {
      sql += " AND warehouse_id = ?";
      params.push(warehouse_id);
    } else if (req.user.role !== "SUPER_ADMIN") {
      if (!req.userWarehouseIds.length) return ok(res, []);
      sql += ` AND warehouse_id IN (${req.userWarehouseIds.map(() => "?").join(",")})`;
      params.push(...req.userWarehouseIds);
    }
    if (party_id) {
      sql += " AND party_id = ?";
      params.push(party_id);
    }
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (search) {
      sql += " AND container_number LIKE ?";
      params.push(`%${search}%`);
    }
    sql += " ORDER BY created_at DESC";
    const rows = db.prepare(sql).all(...params);
    ok(res, rows.map((c) => enrich(c)));
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const c = db.prepare("SELECT * FROM containers WHERE id = ?").get(req.params.id);
    if (!c || c.company_id !== req.companyId) return fail(res, "Container not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(c.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(c.party_id);
    const warehouse = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(c.warehouse_id);
    const loadingHistory = db
      .prepare("SELECT * FROM loading_logs WHERE container_id = ? ORDER BY date_of_loading DESC, created_at DESC")
      .all(c.id);
    const billingHistory = db
      .prepare(
        `SELECT ii.*, i.invoice_number, i.invoice_date, i.status as invoice_status
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
         WHERE ii.container_id = ? ORDER BY i.invoice_date DESC`
      )
      .all(c.id);
    ok(res, { ...enrich(c), party, warehouse, loadingHistory, billingHistory });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { warehouse_id, party_id, container_number, date_of_unloading, initial_packets, rent_type, rent_rate, notes } =
      req.body;

    if (!warehouse_id || !party_id) return fail(res, "Warehouse and party are required.", 400);
    const warehouse = db.prepare("SELECT id, company_id FROM warehouses WHERE id = ?").get(warehouse_id);
    if (!warehouse || warehouse.company_id !== req.companyId) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const party = db.prepare("SELECT id, company_id FROM parties WHERE id = ?").get(party_id);
    if (!party || party.company_id !== req.companyId) return fail(res, "Party not found.", 404);

    if (!container_number?.trim()) return fail(res, "Container number cannot be empty.", 400);
    if (!date_of_unloading || isNaN(Date.parse(date_of_unloading))) return fail(res, "A valid unloading date is required.", 400);
    if (!Number.isFinite(+initial_packets) || +initial_packets <= 0)
      return fail(res, "Initial packets must be greater than 0.", 400);
    if (!["Daily", "Monthly"].includes(rent_type)) return fail(res, "Rent type must be Daily or Monthly.", 400);
    if (!Number.isFinite(+rent_rate) || +rent_rate < 0) return fail(res, "Rent rate cannot be negative.", 400);

    const existing = db
      .prepare("SELECT id FROM containers WHERE warehouse_id = ? AND container_number = ?")
      .get(warehouse_id, container_number.trim());
    if (existing) return fail(res, "Container number already exists.", 409);

    const id = nanoid();
    db.prepare(
      `INSERT INTO containers (id, company_id, warehouse_id, party_id, container_number, date_of_unloading, initial_packets, rent_type, rent_rate, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.companyId,
      warehouse_id,
      party_id,
      container_number.trim(),
      date_of_unloading,
      +initial_packets,
      rent_type,
      +rent_rate,
      notes || "",
      req.user.id
    );
    logAudit({
      user: req.user,
      action: "Created container",
      entity: "container",
      entityId: id,
      warehouseId: warehouse_id,
      details: { container_number },
    });
    ok(res, enrich(db.prepare("SELECT * FROM containers WHERE id=?").get(id)), 201);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const c = db.prepare("SELECT * FROM containers WHERE id = ?").get(req.params.id);
    if (!c || c.company_id !== req.companyId) return fail(res, "Container not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(c.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const { party_id, rent_type, rent_rate, notes } = req.body;
    if (party_id) {
      const party = db.prepare("SELECT id, company_id FROM parties WHERE id = ?").get(party_id);
      if (!party || party.company_id !== req.companyId) return fail(res, "Party not found.", 404);
    }
    db.prepare(
      `UPDATE containers SET party_id=?, rent_type=?, rent_rate=?, notes=?, updated_at=datetime('now') WHERE id=?`
    ).run(party_id ?? c.party_id, rent_type ?? c.rent_type, rent_rate ?? c.rent_rate, notes ?? c.notes, c.id);
    logAudit({ user: req.user, action: "Updated container", entity: "container", entityId: c.id, warehouseId: c.warehouse_id });
    ok(res, enrich(db.prepare("SELECT * FROM containers WHERE id=?").get(c.id)));
  })
);

router.post(
  "/:id/clear",
  asyncHandler(async (req, res) => {
    const c = db.prepare("SELECT * FROM containers WHERE id = ?").get(req.params.id);
    if (!c || c.company_id !== req.companyId) return fail(res, "Container not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(c.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(
      "UPDATE containers SET status='Cleared', cleared_at=datetime('now'), last_loading_date=COALESCE(last_loading_date, ?), updated_at=datetime('now') WHERE id=?"
    ).run(today, c.id);
    logAudit({ user: req.user, action: "Cleared container", entity: "container", entityId: c.id, warehouseId: c.warehouse_id });
    const cleared = db.prepare("SELECT * FROM containers WHERE id=?").get(c.id);
    notifyContainerCleared(cleared, req.user.id);
    ok(res, enrich(cleared));
  })
);

/**
 * Undo a container that was just created by mistake. Only allowed while it
 * has zero real-world history — no loading recorded against it and no
 * invoice ever generated for it — so this can never quietly erase activity
 * that's already happened.
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const c = db.prepare("SELECT * FROM containers WHERE id = ?").get(req.params.id);
    if (!c || c.company_id !== req.companyId) return fail(res, "Container not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(c.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const loadingCount = db.prepare("SELECT COUNT(*) c FROM loading_logs WHERE container_id = ?").get(c.id).c;
    if (loadingCount > 0) {
      return fail(res, "This container already has loading recorded against it, so it can no longer be undone.", 400);
    }
    const invoiceCount = db.prepare("SELECT COUNT(*) c FROM invoice_items WHERE container_id = ?").get(c.id).c;
    if (invoiceCount > 0) {
      return fail(res, "This container has already been billed, so it can no longer be undone.", 400);
    }

    db.prepare("DELETE FROM containers WHERE id = ?").run(c.id);
    logAudit({ user: req.user, action: "Undid container", entity: "container", entityId: c.id, warehouseId: c.warehouse_id, details: { container_number: c.container_number } });
    ok(res, { deleted: true });
  })
);

export default router;
