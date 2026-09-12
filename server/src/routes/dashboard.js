import { Router } from "express";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate } from "../middleware/auth.js";
import { calculateContainerRent, defaultBillableDays } from "../services/billing.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const warehouseId = req.query.warehouse_id;
    let scope = null;
    if (warehouseId && warehouseId !== "all") {
      if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(warehouseId)) {
        return fail(res, "You do not have permission to access this warehouse.", 403);
      }
      scope = [warehouseId];
    } else if (req.user.role !== "SUPER_ADMIN") {
      scope = req.userWarehouseIds;
    }

    let containerSql = "SELECT * FROM containers WHERE 1=1";
    const params = [];
    if (scope) {
      if (!scope.length) {
        return ok(res, {
          activeContainers: 0,
          totalStoredBundles: 0,
          totalLoadedBundles: 0,
          remainingBundles: 0,
          todaysLoading: 0,
          accruedRent: 0,
          outstandingBills: 0,
          clearedContainers: 0,
          recentActivity: [],
        });
      }
      containerSql += ` AND warehouse_id IN (${scope.map(() => "?").join(",")})`;
      params.push(...scope);
    }
    const containers = db.prepare(containerSql).all(...params);
    const active = containers.filter((c) => c.status === "Active");
    const cleared = containers.filter((c) => c.status === "Cleared");
    const today = new Date().toISOString().slice(0, 10);

    const accruedRent = active.reduce((sum, c) => {
      const days = defaultBillableDays(c.date_of_unloading, today);
      return sum + calculateContainerRent({ rentType: c.rent_type, rentRate: c.rent_rate, billableDays: days });
    }, 0);

    let todaysLoadingSql = "SELECT COALESCE(SUM(packets_loaded),0) s FROM loading_logs WHERE date_of_loading = ?";
    const tlParams = [today];
    if (scope) {
      todaysLoadingSql += ` AND warehouse_id IN (${scope.map(() => "?").join(",")})`;
      tlParams.push(...scope);
    }
    const todaysLoading = db.prepare(todaysLoadingSql).get(...tlParams).s;

    let outstandingSql = "SELECT COALESCE(SUM(balance),0) s FROM invoices WHERE status != 'Cancelled'";
    const obParams = [];
    if (scope) {
      outstandingSql += ` AND warehouse_id IN (${scope.map(() => "?").join(",")})`;
      obParams.push(...scope);
    }
    const outstandingBills = db.prepare(outstandingSql).get(...obParams).s;

    let auditSql = "SELECT * FROM audit_logs WHERE 1=1";
    const auditParams = [];
    if (scope) {
      auditSql += ` AND (warehouse_id IN (${scope.map(() => "?").join(",")}) OR warehouse_id IS NULL)`;
      auditParams.push(...scope);
    }
    auditSql += " ORDER BY created_at DESC LIMIT 10";
    const recentActivity = db.prepare(auditSql).all(...auditParams);

    ok(res, {
      activeContainers: active.length,
      totalStoredBundles: active.reduce((s, c) => s + (c.initial_packets - c.loaded_packets), 0),
      totalLoadedBundles: containers.reduce((s, c) => s + c.loaded_packets, 0),
      remainingBundles: active.reduce((s, c) => s + (c.initial_packets - c.loaded_packets), 0),
      todaysLoading,
      accruedRent,
      outstandingBills,
      clearedContainers: cleared.length,
      recentActivity,
    });
  })
);

export default router;
