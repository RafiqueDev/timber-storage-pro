import { Router } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate, authorizeRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

const router = Router();
router.use(authenticate, authorizeRole("SUPER_ADMIN"));

function sanitize(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

/** Every warehouse id passed in must actually belong to the acting admin's own company. */
function warehouseIdsBelongToCompany(companyId, ids) {
  if (!ids.length) return true;
  const placeholders = ids.map(() => "?").join(",");
  const count = db.prepare(`SELECT COUNT(*) c FROM warehouses WHERE company_id = ? AND id IN (${placeholders})`).get(companyId, ...ids).c;
  return count === ids.length;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = db.prepare("SELECT * FROM users WHERE company_id = ? ORDER BY name").all(req.companyId);
    ok(
      res,
      users.map((u) => {
        const warehouses = db
          .prepare(`SELECT w.* FROM warehouses w JOIN user_warehouses uw ON uw.warehouse_id=w.id WHERE uw.user_id=?`)
          .all(u.id);
        return { ...sanitize(u), warehouses };
      })
    );
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, username, email, password, role, warehouse_ids = [] } = req.body;
    if (!name?.trim() || !username?.trim() || !password) return fail(res, "Name, username and password are required.", 400);
    if (!["SUPER_ADMIN", "BRANCH_MANAGER", "STAFF"].includes(role)) return fail(res, "Invalid role.", 400);
    if (!warehouseIdsBelongToCompany(req.companyId, warehouse_ids)) {
      return fail(res, "One or more selected warehouses are invalid.", 400);
    }
    // Usernames are unique across the whole platform, matching the Setup
    // sign-up flow — see routes/setup.js for why.
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim());
    if (existing) return fail(res, "Username is already taken.", 409);

    const id = nanoid();
    const hash = bcrypt.hashSync(password, 10);
    const txn = db.transaction(() => {
      db.prepare("INSERT INTO users (id, company_id, name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        req.companyId,
        name.trim(),
        username.trim(),
        email || "",
        hash,
        role
      );
      for (const wid of warehouse_ids) {
        db.prepare("INSERT OR IGNORE INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)").run(id, wid);
      }
    });
    txn();
    logAudit({ user: req.user, action: "Created user", entity: "user", entityId: id, details: { username, role } });
    ok(res, sanitize(db.prepare("SELECT * FROM users WHERE id=?").get(id)), 201);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!u || u.company_id !== req.companyId) return fail(res, "User not found.", 404);
    const { name, email, role, status, warehouse_ids } = req.body;
    if (Array.isArray(warehouse_ids) && !warehouseIdsBelongToCompany(req.companyId, warehouse_ids)) {
      return fail(res, "One or more selected warehouses are invalid.", 400);
    }
    const txn = db.transaction(() => {
      db.prepare("UPDATE users SET name=?, email=?, role=?, status=?, updated_at=datetime('now') WHERE id=?").run(
        name ?? u.name,
        email ?? u.email,
        role ?? u.role,
        status ?? u.status,
        u.id
      );
      if (Array.isArray(warehouse_ids)) {
        db.prepare("DELETE FROM user_warehouses WHERE user_id=?").run(u.id);
        for (const wid of warehouse_ids) {
          db.prepare("INSERT OR IGNORE INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)").run(u.id, wid);
        }
      }
    });
    txn();
    logAudit({ user: req.user, action: "Updated user", entity: "user", entityId: u.id });
    ok(res, sanitize(db.prepare("SELECT * FROM users WHERE id=?").get(u.id)));
  })
);

router.post(
  "/:id/reset-password",
  asyncHandler(async (req, res) => {
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!target || target.company_id !== req.companyId) return fail(res, "User not found.", 404);
    const { password } = req.body;
    if (!password || password.length < 6) return fail(res, "New password must be at least 6 characters.", 400);
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?").run(hash, target.id);
    logAudit({ user: req.user, action: "Reset user password", entity: "user", entityId: target.id });
    ok(res, { reset: true });
  })
);

export default router;
