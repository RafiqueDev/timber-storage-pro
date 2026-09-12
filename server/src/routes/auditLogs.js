import { Router } from "express";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate, authorizeRole } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, authorizeRole("SUPER_ADMIN", "BRANCH_MANAGER"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { warehouse_id, action, start, end } = req.query;
    if (warehouse_id && req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    let sql = "SELECT * FROM audit_logs WHERE 1=1";
    const params = [];
    if (warehouse_id) {
      sql += " AND warehouse_id = ?";
      params.push(warehouse_id);
    } else if (req.user.role !== "SUPER_ADMIN") {
      if (!req.userWarehouseIds.length) return ok(res, []);
      sql += ` AND (warehouse_id IN (${req.userWarehouseIds.map(() => "?").join(",")}) OR warehouse_id IS NULL)`;
      params.push(...req.userWarehouseIds);
    }
    if (action) {
      sql += " AND action LIKE ?";
      params.push(`%${action}%`);
    }
    if (start) {
      sql += " AND created_at >= ?";
      params.push(start);
    }
    if (end) {
      sql += " AND created_at <= ?";
      params.push(end + " 23:59:59");
    }
    sql += " ORDER BY created_at DESC LIMIT 500";
    ok(res, db.prepare(sql).all(...params));
  })
);

export default router;
