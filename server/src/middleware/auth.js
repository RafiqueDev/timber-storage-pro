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
 * SUPER_ADMIN can access everything. Others must be explicitly assigned.
 * This MUST be called server-side on every warehouse-scoped route — never
 * trust the frontend's active-warehouse selection.
 */
export function authorizeWarehouse(getWarehouseId) {
  return (req, res, next) => {
    const warehouseId = getWarehouseId(req);
    if (!warehouseId) return next(); // route may be warehouse-agnostic (e.g. "all")
    if (req.user.role === "SUPER_ADMIN") return next();
    if (req.userWarehouseIds.includes(warehouseId)) return next();
    return fail(res, "You do not have permission to access this warehouse.", 403);
  };
}
