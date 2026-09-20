import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";
import { notifyContainerCleared } from "../services/notifications.js";

/**
 * Recomputes a container's loaded/remaining/status from the current set of
 * its loading_logs rows (call this AFTER inserting/updating/deleting a log,
 * inside the same transaction) — shared by edit and delete so both stay
 * exactly consistent instead of drifting apart over time.
 */
function recomputeContainerFromLogs(container) {
  const newTotalLoaded = db.prepare("SELECT COALESCE(SUM(packets_loaded),0) s FROM loading_logs WHERE container_id = ?").get(container.id).s;
  const remaining = container.initial_packets - newTotalLoaded;
  const latestDate = db.prepare("SELECT MAX(date_of_loading) d FROM loading_logs WHERE container_id = ?").get(container.id).d;

  if (remaining === 0 && newTotalLoaded > 0) {
    db.prepare(
      `UPDATE containers SET loaded_packets=?, last_loading_date=?, status='Cleared', cleared_at=COALESCE(cleared_at, datetime('now')), updated_at=datetime('now') WHERE id=?`
    ).run(newTotalLoaded, latestDate, container.id);
  } else if (container.status === "Cleared" && remaining > 0) {
    db.prepare(
      `UPDATE containers SET loaded_packets=?, last_loading_date=?, status='Active', cleared_at=NULL, updated_at=datetime('now') WHERE id=?`
    ).run(newTotalLoaded, latestDate, container.id);
  } else {
    db.prepare(`UPDATE containers SET loaded_packets=?, last_loading_date=?, updated_at=datetime('now') WHERE id=?`).run(newTotalLoaded, latestDate, container.id);
  }
  return newTotalLoaded;
}

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { warehouse_id, party_id, container_id, vehicle_number, start, end, search } = req.query;
    let sql = `SELECT l.*, c.container_number, p.party_name, w.branch_name
               FROM loading_logs l
               JOIN containers c ON c.id = l.container_id
               JOIN parties p ON p.id = l.party_id
               JOIN warehouses w ON w.id = l.warehouse_id
               WHERE l.company_id = ?`;
    const params = [req.companyId];
    if (warehouse_id) {
      sql += " AND l.warehouse_id = ?";
      params.push(warehouse_id);
    } else if (req.user.role !== "SUPER_ADMIN") {
      if (!req.userWarehouseIds.length) return ok(res, []);
      sql += ` AND l.warehouse_id IN (${req.userWarehouseIds.map(() => "?").join(",")})`;
      params.push(...req.userWarehouseIds);
    }
    if (party_id) {
      sql += " AND l.party_id = ?";
      params.push(party_id);
    }
    if (container_id) {
      sql += " AND l.container_id = ?";
      params.push(container_id);
    }
    if (vehicle_number) {
      sql += " AND l.vehicle_number LIKE ?";
      params.push(`%${vehicle_number}%`);
    }
    if (start) {
      sql += " AND l.date_of_loading >= ?";
      params.push(start);
    }
    if (end) {
      sql += " AND l.date_of_loading <= ?";
      params.push(end);
    }
    if (search) {
      sql += " AND (c.container_number LIKE ? OR p.party_name LIKE ? OR l.vehicle_number LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += " ORDER BY l.date_of_loading DESC, l.created_at DESC LIMIT 500";
    ok(res, db.prepare(sql).all(...params));
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { container_id, date_of_loading, packets_loaded, vehicle_number, driver_number, description } = req.body;
    const container = db.prepare("SELECT * FROM containers WHERE id = ?").get(container_id);
    if (!container || container.company_id !== req.companyId) return fail(res, "Invalid container.", 400);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(container.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    if (container.status !== "Active") return fail(res, "This container has already been cleared.", 400);

    const qty = +packets_loaded;
    if (!Number.isFinite(qty) || qty <= 0) return fail(res, "Please enter a valid loading quantity.", 400);
    if (!date_of_loading || isNaN(Date.parse(date_of_loading))) return fail(res, "A valid loading date is required.", 400);
    if (date_of_loading < container.date_of_unloading)
      return fail(res, "Loading date cannot be before the container's unloading date.", 400);

    const remaining = container.initial_packets - container.loaded_packets;
    if (qty > remaining) return fail(res, `Loading quantity cannot exceed remaining bundles (${remaining} available).`, 400);

    // Atomic, concurrency-safe update: the WHERE clause re-checks remaining
    // stock at write time so two simultaneous requests can never push the
    // remaining quantity negative (spec #127, #128).
    const txn = db.transaction(() => {
      const result = db
        .prepare(
          `UPDATE containers SET loaded_packets = loaded_packets + ?, updated_at = datetime('now')
           WHERE id = ? AND (initial_packets - loaded_packets) >= ?`
        )
        .run(qty, container_id, qty);
      if (result.changes === 0) {
        throw new Error("STOCK_CONFLICT");
      }
      const logId = nanoid();
      db.prepare(
        `INSERT INTO loading_logs (id, company_id, container_id, warehouse_id, party_id, date_of_loading, packets_loaded, vehicle_number, driver_number, description, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        logId,
        req.companyId,
        container_id,
        container.warehouse_id,
        container.party_id,
        date_of_loading,
        qty,
        vehicle_number || "",
        driver_number || "",
        description || "",
        req.user.id
      );
      // Track the exact date of the most recent loading activity, independent
      // of status, so history/billing can reference precisely when a
      // container was last touched — including after it's fully cleared.
      const latestDate = !container.last_loading_date || date_of_loading > container.last_loading_date
        ? date_of_loading
        : container.last_loading_date;
      db.prepare("UPDATE containers SET last_loading_date = ? WHERE id = ?").run(latestDate, container_id);

      const updated = db.prepare("SELECT * FROM containers WHERE id = ?").get(container_id);
      const nowCleared = updated.initial_packets - updated.loaded_packets === 0;
      if (nowCleared) {
        db.prepare("UPDATE containers SET status='Cleared', cleared_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(
          container_id
        );
      }
      return { logId, nowCleared, remainingAfter: updated.initial_packets - updated.loaded_packets };
    });

    let result;
    try {
      result = txn();
    } catch (e) {
      if (e.message === "STOCK_CONFLICT") {
        return fail(res, "Remaining stock changed before this could be saved. Please refresh and try again.", 409);
      }
      throw e;
    }
    const { logId, nowCleared } = result;

    logAudit({
      user: req.user,
      action: "Recorded loading",
      entity: "loading_log",
      entityId: logId,
      warehouseId: container.warehouse_id,
      details: { container: container.container_number, packets_loaded: qty },
    });

    const finalContainer = db.prepare("SELECT * FROM containers WHERE id = ?").get(container_id);
    if (nowCleared) {
      notifyContainerCleared(finalContainer, req.user.id);
    }
    // Low-stock alerts were removed by request — container cards and
    // notifications no longer flag "low remaining stock".

    ok(
      res,
      { log: db.prepare("SELECT * FROM loading_logs WHERE id=?").get(logId), container: finalContainer },
      201
    );
  })
);

/**
 * Edit a loading log entry — quantity, date, vehicle/driver/description.
 * Rather than patching the container's loaded_packets by a delta (error
 * prone if logs are edited more than once), this recomputes it from the
 * SUM of all of that container's logs after the edit, then re-derives
 * status/cleared_at/last_loading_date from that fresh total — so the
 * container's numbers can never drift out of sync with its own history.
 */
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const log = db.prepare("SELECT * FROM loading_logs WHERE id = ?").get(req.params.id);
    if (!log || log.company_id !== req.companyId) return fail(res, "Loading record not found.", 404);
    const container = db.prepare("SELECT * FROM containers WHERE id = ?").get(log.container_id);
    if (!container) return fail(res, "Container not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(container.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }

    const { date_of_loading, packets_loaded, vehicle_number, driver_number, description } = req.body;
    const qty = +packets_loaded;
    if (!Number.isFinite(qty) || qty <= 0) return fail(res, "Please enter a valid loading quantity.", 400);
    if (!date_of_loading || isNaN(Date.parse(date_of_loading))) return fail(res, "A valid loading date is required.", 400);
    if (date_of_loading < container.date_of_unloading) {
      return fail(res, "Loading date cannot be before the container's unloading date.", 400);
    }

    // What would the container's total loaded quantity be with this edit
    // applied, across every OTHER log for the same container?
    const otherLogsTotal = db
      .prepare("SELECT COALESCE(SUM(packets_loaded),0) s FROM loading_logs WHERE container_id = ? AND id != ?")
      .get(container.id, log.id).s;
    const newTotalLoaded = otherLogsTotal + qty;
    if (newTotalLoaded > container.initial_packets) {
      const maxAllowed = container.initial_packets - otherLogsTotal;
      return fail(res, `This quantity would exceed the container's initial bundles. Maximum allowed here is ${maxAllowed}.`, 400);
    }

    const txn = db.transaction(() => {
      db.prepare(
        `UPDATE loading_logs SET date_of_loading=?, packets_loaded=?, vehicle_number=?, driver_number=?, description=? WHERE id=?`
      ).run(date_of_loading, qty, vehicle_number || "", driver_number || "", description || "", log.id);
      recomputeContainerFromLogs(container);
    });
    txn();

    logAudit({
      user: req.user,
      action: "Edited loading record",
      entity: "loading_log",
      entityId: log.id,
      warehouseId: container.warehouse_id,
      details: { container: container.container_number, old_packets_loaded: log.packets_loaded, new_packets_loaded: qty },
    });

    ok(res, {
      log: db.prepare("SELECT * FROM loading_logs WHERE id=?").get(log.id),
      container: db.prepare("SELECT * FROM containers WHERE id=?").get(container.id),
    });
  })
);

/**
 * Undo a loading record entirely (as opposed to editing it). Recomputes the
 * container the same way an edit does, so removing an entry can correctly
 * un-clear a container if it was the one that had emptied it out.
 */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const log = db.prepare("SELECT * FROM loading_logs WHERE id = ?").get(req.params.id);
    if (!log || log.company_id !== req.companyId) return fail(res, "Loading record not found.", 404);
    const container = db.prepare("SELECT * FROM containers WHERE id = ?").get(log.container_id);
    if (!container) return fail(res, "Container not found.", 404);
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(container.warehouse_id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }

    const txn = db.transaction(() => {
      db.prepare("DELETE FROM loading_logs WHERE id = ?").run(log.id);
      recomputeContainerFromLogs(container);
    });
    txn();

    logAudit({
      user: req.user,
      action: "Undid loading record",
      entity: "loading_log",
      entityId: log.id,
      warehouseId: container.warehouse_id,
      details: { container: container.container_number, packets_loaded: log.packets_loaded },
    });

    ok(res, { container: db.prepare("SELECT * FROM containers WHERE id=?").get(container.id) });
  })
);

export default router;
