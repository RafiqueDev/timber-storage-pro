import jwt from "jsonwebtoken";
import db from "../db.js";
import { fail } from "../utils/response.js";

export function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return fail(res, "Authentication required.", 401);
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET || "dev_secret");
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (!user || user.status !== "Active") return fail(res, "Session is no longer valid.", 401);
    req.user = user;
    // Every request is scoped to exactly one company — the one the
    // authenticated user belongs to. This is the multi-tenant boundary:
    // every route that touches company-owned data (warehouses, parties,
    // containers, invoices, users, ...) must filter/verify against this,
    // not just against warehouse assignment, so one company's admin can
    // never reach into another company's data by id.
    req.companyId = user.company_id;
    req.userWarehouseIds = db
      .prepare("SELECT warehouse_id FROM user_warehouses WHERE user_id = ?")
      .all(user.id)
      .map((r) => r.warehouse_id);
    next();
  } catch {
    return fail(res, "Invalid or expired session. Please log in again.", 401);
  }
}

export function authorizeRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return fail(res, "You do not have permission to perform this action.", 403);
    }
    next();
  };
}

/**
 * Verifies the requesting user is allowed to touch the given warehouseId.
 * Two independent checks, both required:
 *  1. The warehouse must belong to the requester's own company — this
 *     applies to EVERYONE, including SUPER_ADMIN. A Super Admin's power is
 *     absolute only within their own company, never across companies.
 *  2. Within that company, SUPER_ADMIN can access every warehouse; anyone
 *     else must be explicitly assigned to it.
 * This MUST be called server-side on every warehouse-scoped route — never
 * trust the frontend's active-warehouse selection.
 */
export function authorizeWarehouse(getWarehouseId) {
  return (req, res, next) => {
    const warehouseId = getWarehouseId(req);
    if (!warehouseId) return next(); // route may be warehouse-agnostic (e.g. "all")
    const warehouse = db.prepare("SELECT id, company_id FROM warehouses WHERE id = ?").get(warehouseId);
    if (!warehouse || warehouse.company_id !== req.companyId) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    if (req.user.role === "SUPER_ADMIN") return next();
    if (req.userWarehouseIds.includes(warehouseId)) return next();
    return fail(res, "You do not have permission to access this warehouse.", 403);
  };
}

/**
 * Same two-part check as authorizeWarehouse, but as a plain function for
 * routes that need to run it inline rather than as middleware (e.g. after
 * already loading the warehouse row for other reasons).
 */
export function canAccessWarehouse(req, warehouseId) {
  if (!warehouseId) return true;
  const warehouse = db.prepare("SELECT id, company_id FROM warehouses WHERE id = ?").get(warehouseId);
  if (!warehouse || warehouse.company_id !== req.companyId) return false;
  if (req.user.role === "SUPER_ADMIN") return true;
  return req.userWarehouseIds.includes(warehouseId);
}
