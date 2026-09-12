import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

const router = Router();

function sanitizeUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

function issueTokens(user) {
  const accessToken = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_ACCESS_SECRET || "dev_secret", {
    expiresIn: "8h",
  });
  const refreshToken = jwt.sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET || "dev_refresh_secret", {
    expiresIn: "30d",
  });
  return { accessToken, refreshToken };
}

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return fail(res, "Username and password are required.", 400);
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim());
    if (!user || user.status !== "Active") return fail(res, "Invalid username or password.", 401);
    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) return fail(res, "Invalid username or password.", 401);

    const warehouses = db
      .prepare(
        `SELECT w.* FROM warehouses w
         JOIN user_warehouses uw ON uw.warehouse_id = w.id
         WHERE uw.user_id = ?`
      )
      .all(user.id);

    const tokens = issueTokens(user);
    logAudit({ user, action: "Login" });
    ok(res, { user: sanitizeUser(user), warehouses, ...tokens });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return fail(res, "Refresh token required.", 400);
    try {
      const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || "dev_refresh_secret");
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
      if (!user || user.status !== "Active") return fail(res, "Session expired.", 401);
      const tokens = issueTokens(user);
      ok(res, tokens);
    } catch {
      return fail(res, "Session expired. Please log in again.", 401);
    }
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    logAudit({ user: req.user, action: "Logout" });
    ok(res, { loggedOut: true });
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const warehouses =
      req.user.role === "SUPER_ADMIN"
        ? db.prepare("SELECT * FROM warehouses").all()
        : db
            .prepare(
              `SELECT w.* FROM warehouses w
               JOIN user_warehouses uw ON uw.warehouse_id = w.id
               WHERE uw.user_id = ?`
            )
            .all(req.user.id);
    ok(res, { user: sanitizeUser(req.user), warehouses });
  })
);

export default router;
