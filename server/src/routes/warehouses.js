import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate, authorizeRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows =
      req.user.role === "SUPER_ADMIN"
        ? db.prepare("SELECT * FROM warehouses ORDER BY branch_name").all()
        : db
            .prepare(
              `SELECT w.* FROM warehouses w
               JOIN user_warehouses uw ON uw.warehouse_id = w.id
               WHERE uw.user_id = ? ORDER BY w.branch_name`
            )
            .all(req.user.id);
    ok(res, rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "SUPER_ADMIN" && !req.userWarehouseIds.includes(req.params.id)) {
      return fail(res, "You do not have permission to access this warehouse.", 403);
    }
    const w = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(req.params.id);
    if (!w) return fail(res, "Warehouse not found.", 404);
    const managers = db
      .prepare(
        `SELECT u.id, u.name, u.role FROM users u
         JOIN user_warehouses uw ON uw.user_id = u.id WHERE uw.warehouse_id = ?`
      )
      .all(w.id);
    const activeContainers = db
      .prepare("SELECT COUNT(*) c FROM containers WHERE warehouse_id = ? AND status = 'Active'")
      .get(w.id).c;
    const storedBundles = db
      .prepare(
        "SELECT COALESCE(SUM(initial_packets - loaded_packets),0) s FROM containers WHERE warehouse_id = ? AND status='Active'"
      )
      .get(w.id).s;
    ok(res, { ...w, managers, activeContainers, storedBundles });
  })
);

router.post(
  "/",
  authorizeRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { branch_name, branch_address, location, contact_number } = req.body;
    if (!branch_name?.trim()) return fail(res, "Branch name is required.", 400);
    const id = nanoid();
    db.prepare(
      `INSERT INTO warehouses (id, company_id, branch_name, branch_address, location, contact_number)
       VALUES (?, 'default', ?, ?, ?, ?)`
    ).run(id, branch_name.trim(), branch_address || "", location || "", contact_number || "");
    logAudit({ user: req.user, action: "Created warehouse", entity: "warehouse", entityId: id, details: { branch_name } });
    ok(res, db.prepare("SELECT * FROM warehouses WHERE id=?").get(id), 201);
  })
);

router.put(
  "/:id",
  authorizeRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const w = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(req.params.id);
    if (!w) return fail(res, "Warehouse not found.", 404);
    const { branch_name, branch_address, location, contact_number, status } = req.body;
    db.prepare(
      `UPDATE warehouses SET branch_name=?, branch_address=?, location=?, contact_number=?, status=?, updated_at=datetime('now') WHERE id=?`
    ).run(
      branch_name ?? w.branch_name,
      branch_address ?? w.branch_address,
      location ?? w.location,
      contact_number ?? w.contact_number,
      status ?? w.status,
      w.id
    );
    logAudit({ user: req.user, action: "Updated warehouse", entity: "warehouse", entityId: w.id });
    ok(res, db.prepare("SELECT * FROM warehouses WHERE id=?").get(w.id));
  })
);

router.delete(
  "/:id",
  authorizeRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    // Soft delete only — financial/storage records must remain auditable (spec #101).
    db.prepare("UPDATE warehouses SET status='Inactive', updated_at=datetime('now') WHERE id=?").run(req.params.id);
    logAudit({ user: req.user, action: "Deactivated warehouse", entity: "warehouse", entityId: req.params.id });
    ok(res, { deactivated: true });
  })
);

export default router;
