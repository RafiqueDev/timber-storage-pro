import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { logAudit } from "../services/audit.js";

const router = Router();

/**
 * This app has no public sign-up page by design (it's an internal admin
 * tool, not a self-serve SaaS) — EXCEPT for this one bootstrap flow, which
 * is only reachable while the system has zero users. The moment a Super
 * Admin account exists, POST here is permanently refused, so this can never
 * be used to hijack an already-running system.
 */
function systemInitialized() {
  return db.prepare("SELECT COUNT(*) c FROM users").get().c > 0;
}

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    ok(res, { initialized: systemInitialized() });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    if (systemInitialized()) {
      return fail(res, "This system has already been set up. Please log in instead.", 403);
    }

    const { companyName, currencySymbol, adminName, username, email, password } = req.body;

    if (!companyName?.trim()) return fail(res, "Company name is required.", 400);
    if (!adminName?.trim()) return fail(res, "Your name is required.", 400);
    if (!username?.trim() || username.trim().length < 3) return fail(res, "Username must be at least 3 characters.", 400);
    if (!/^[a-zA-Z0-9_.-]+$/.test(username.trim())) {
      return fail(res, "Username can only contain letters, numbers, dots, hyphens, and underscores.", 400);
    }
    if (!password || password.length < 6) return fail(res, "Password must be at least 6 characters.", 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return fail(res, "Please enter a valid email address.", 400);

    // Re-check inside the transaction to close the race window between two
    // simultaneous setup submissions (extremely unlikely, but free to guard).
    const txn = db.transaction(() => {
      if (systemInitialized()) throw new Error("ALREADY_INITIALIZED");

      // Clear out anything left over (e.g. a previously wiped seed) so
      // setup always starts from a genuinely clean slate.
      db.prepare("DELETE FROM notifications").run();
      db.prepare("DELETE FROM audit_logs").run();
      db.prepare("DELETE FROM payments").run();
      db.prepare("DELETE FROM invoice_items").run();
      db.prepare("DELETE FROM invoices").run();
      db.prepare("DELETE FROM loading_logs").run();
      db.prepare("DELETE FROM containers").run();
      db.prepare("DELETE FROM parties").run();
      db.prepare("DELETE FROM user_warehouses").run();
      db.prepare("DELETE FROM users").run();
      db.prepare("DELETE FROM warehouses").run();
      db.prepare("DELETE FROM companies").run();

      db.prepare(
        `INSERT INTO companies (id, name, currency, currency_symbol, invoice_prefix, date_format, timezone, low_stock_threshold, next_invoice_seq, developer_name)
         VALUES ('default', ?, 'PKR', ?, 'INV', 'DD-MM-YYYY', 'Asia/Karachi', 25, 1, ?)`
      ).run(companyName.trim(), (currencySymbol || "Rs.").trim(), companyName.trim());

      const adminId = nanoid();
      db.prepare(
        "INSERT INTO users (id, name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'SUPER_ADMIN')"
      ).run(adminId, adminName.trim(), username.trim(), email?.trim() || "", bcrypt.hashSync(password, 10));

      return adminId;
    });

    let adminId;
    try {
      adminId = txn();
    } catch (e) {
      if (e.message === "ALREADY_INITIALIZED") {
        return fail(res, "This system has already been set up. Please log in instead.", 403);
      }
      throw e;
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(adminId);
    logAudit({ user, action: "Completed first-time setup", entity: "company", details: { companyName: companyName.trim() } });

    // Log the new admin straight in — no need to make them re-enter the
    // password they just chose on a separate login screen.
    const accessToken = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_ACCESS_SECRET || "dev_secret", { expiresIn: "8h" });
    const refreshToken = jwt.sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET || "dev_refresh_secret", { expiresIn: "30d" });

    const { password_hash, ...safeUser } = user;
    ok(res, { user: safeUser, warehouses: [], accessToken, refreshToken }, 201);
  })
);

export default router;
