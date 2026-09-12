import { Router } from "express";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate } from "../middleware/auth.js";
import { calculateContainerRent, billingReferenceDate, daysBetween } from "../services/billing.js";

const router = Router();
router.use(authenticate);

/**
 * Resolves the warehouse_id filter for a report request.
 * { ids: null } means "no filter" (Super Admin, none specified).
 * { ids: [...] } is the concrete list of warehouse ids to restrict to.
 * { forbidden: true } means a non-admin explicitly asked for a warehouse
 * they aren't assigned to — the caller must refuse the request outright,
 * never silently fall back to "show everything" or "show nothing".
 */
function scopeWarehouses(req, warehouse_id) {
  if (warehouse_id) {
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(warehouse_id)) {
      return { forbidden: true };
    }
    return { ids: [warehouse_id] };
  }
  if (req.user.role === "SUPER_ADMIN") return { ids: null };
  return { ids: req.userWarehouseIds };
}

router.get(
  "/storage",
  asyncHandler(async (req, res) => {
    const scope = scopeWarehouses(req, req.query.warehouse_id);
    if (scope.forbidden) return fail(res, "You do not have permission to access this warehouse.", 403);
    let sql = `SELECT c.*, p.party_name, w.branch_name FROM containers c
               JOIN parties p ON p.id=c.party_id JOIN warehouses w ON w.id=c.warehouse_id WHERE 1=1`;
    const params = [];
    if (scope.ids) {
      if (!scope.ids.length) return ok(res, []);
      sql += ` AND c.warehouse_id IN (${scope.ids.map(() => "?").join(",")})`;
      params.push(...scope.ids);
    }
    if (req.query.status) {
      sql += " AND c.status = ?";
      params.push(req.query.status);
    }
    if (req.query.party_id) {
      sql += " AND c.party_id = ?";
      params.push(req.query.party_id);
    }
    if (req.query.search) {
      sql += " AND (c.container_number LIKE ? OR p.party_name LIKE ?)";
      params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }
    const rows = db.prepare(sql).all(...params);
    const today = new Date().toISOString().slice(0, 10);
    ok(
      res,
      rows.map((c) => {
        const remaining = c.initial_packets - c.loaded_packets;
        const days = daysBetween(c.date_of_unloading, billingReferenceDate(c, today));
        const accrued = calculateContainerRent({ rentType: c.rent_type, rentRate: c.rent_rate, billableDays: days });
        return { ...c, remaining, accruedRent: accrued };
      })
    );
  })
);

router.get(
  "/loading",
  asyncHandler(async (req, res) => {
    const scope = scopeWarehouses(req, req.query.warehouse_id);
    if (scope.forbidden) return fail(res, "You do not have permission to access this warehouse.", 403);
    let sql = `SELECT l.*, c.container_number, p.party_name, w.branch_name FROM loading_logs l
               JOIN containers c ON c.id=l.container_id JOIN parties p ON p.id=l.party_id JOIN warehouses w ON w.id=l.warehouse_id
               WHERE 1=1`;
    const params = [];
    if (scope.ids) {
      if (!scope.ids.length) return ok(res, []);
      sql += ` AND l.warehouse_id IN (${scope.ids.map(() => "?").join(",")})`;
      params.push(...scope.ids);
    }
    if (req.query.start) {
      sql += " AND l.date_of_loading >= ?";
      params.push(req.query.start);
    }
    if (req.query.end) {
      sql += " AND l.date_of_loading <= ?";
      params.push(req.query.end);
    }
    if (req.query.party_id) {
      sql += " AND l.party_id = ?";
      params.push(req.query.party_id);
    }
    if (req.query.search) {
      sql += " AND (c.container_number LIKE ? OR p.party_name LIKE ? OR l.vehicle_number LIKE ?)";
      params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
    }
    sql += " ORDER BY l.date_of_loading DESC";
    ok(res, db.prepare(sql).all(...params));
  })
);

router.get(
  "/rent",
  asyncHandler(async (req, res) => {
    const scope = scopeWarehouses(req, req.query.warehouse_id);
    if (scope.forbidden) return fail(res, "You do not have permission to access this warehouse.", 403);
    let sql = `SELECT c.*, p.party_name, w.branch_name FROM containers c
               JOIN parties p ON p.id=c.party_id JOIN warehouses w ON w.id=c.warehouse_id WHERE 1=1`;
    const params = [];
    if (scope.ids) {
      if (!scope.ids.length) return ok(res, []);
      sql += ` AND c.warehouse_id IN (${scope.ids.map(() => "?").join(",")})`;
      params.push(...scope.ids);
    }
    if (req.query.status) {
      sql += " AND c.status = ?";
      params.push(req.query.status);
    }
    if (req.query.party_id) {
      sql += " AND c.party_id = ?";
      params.push(req.query.party_id);
    }
    if (req.query.search) {
      sql += " AND (c.container_number LIKE ? OR p.party_name LIKE ?)";
      params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }
    const rows = db.prepare(sql).all(...params);
    const today = new Date().toISOString().slice(0, 10);
    ok(
      res,
      rows.map((c) => {
        const days = daysBetween(c.date_of_unloading, billingReferenceDate(c, today));
        const accrued = calculateContainerRent({ rentType: c.rent_type, rentRate: c.rent_rate, billableDays: days });
        const billed = db
          .prepare(
            `SELECT COALESCE(SUM(ii.calculated_rent),0) s FROM invoice_items ii
             JOIN invoices i ON i.id=ii.invoice_id WHERE ii.container_id=? AND i.status!='Cancelled'`
          )
          .get(c.id).s;
        return { ...c, days, accruedRent: accrued, billed, outstanding: Math.max(accrued - billed, 0) };
      })
    );
  })
);

router.get(
  "/warehouse-performance",
  asyncHandler(async (req, res) => {
    const warehouses =
      req.user.role === "SUPER_ADMIN"
        ? db.prepare("SELECT * FROM warehouses").all()
        : db.prepare(`SELECT * FROM warehouses WHERE id IN (${req.userWarehouseIds.map(() => "?").join(",") || "''"})`).all(...req.userWarehouseIds);

    ok(
      res,
      warehouses.map((w) => {
        const activeContainers = db.prepare("SELECT COUNT(*) c FROM containers WHERE warehouse_id=? AND status='Active'").get(w.id).c;
        const storedBundles = db
          .prepare("SELECT COALESCE(SUM(initial_packets-loaded_packets),0) s FROM containers WHERE warehouse_id=? AND status='Active'")
          .get(w.id).s;
        const outstanding = db
          .prepare("SELECT COALESCE(SUM(balance),0) s FROM invoices WHERE warehouse_id=? AND status != 'Cancelled'")
          .get(w.id).s;
        const totalInvoiced = db.prepare("SELECT COALESCE(SUM(subtotal),0) s FROM invoices WHERE warehouse_id=? AND status != 'Cancelled'").get(w.id).s;
        return { ...w, activeContainers, storedBundles, outstanding, totalInvoiced };
      })
    );
  })
);

export default router;
