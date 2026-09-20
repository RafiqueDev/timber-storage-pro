import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { logAudit } from "../services/audit.js";

const router = Router();

/**
 * Multi-tenant "create account" flow: every submission creates a brand new
 * company plus exactly one Super Admin account scoped to it. Unlike the
 * original single-tenant version of this endpoint, there is no "already
 * initialized" lock — anyone can create a new, completely isolated company
 * account at any time, the same way a normal SaaS sign-up works. Isolation
 * is enforced everywhere else (every route filters by the requester's own
 * company_id), so a new company here can never see or touch another
 * company's warehouses, parties, containers, invoices, or users.
 */
router.get(
  "/status",
  asyncHandler(async (req, res) => {
    // Kept for backward compatibility with older frontend builds, but no
    // longer used to lock the Setup screen — it's always reachable now.
    const count = db.prepare("SELECT COUNT(*) c FROM companies").get().c;
    ok(res, { initialized: count > 0 });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { companyName, currencySymbol, adminName, username, email, password } = req.body;

    if (!companyName?.trim()) return fail(res, "Company name is required.", 400);
    if (!adminName?.trim()) return fail(res, "Your name is required.", 400);
    if (!username?.trim() || username.trim().length < 3) return fail(res, "Username must be at least 3 characters.", 400);
    if (!/^[a-zA-Z0-9_.-]+$/.test(username.trim())) {
      return fail(res, "Username can only contain letters, numbers, dots, hyphens, and underscores.", 400);
    }
    if (!password || password.length < 6) return fail(res, "Password must be at least 6 characters.", 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return fail(res, "Please enter a valid email address.", 400);

    // Usernames are unique across the whole platform (not just within one
    // company) — simplest, most predictable behavior for login-by-username,
    // the same way most multi-tenant products with a single login screen work.
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim());
    if (existing) return fail(res, "That username is already taken. Please choose another.", 409);

    const companyId = nanoid();
    const adminId = nanoid();

    const txn = db.transaction(() => {
      // Re-check inside the transaction to close the (extremely unlikely)
      // race window between two simultaneous sign-ups choosing the same
      // username.
      const raceCheck = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim());
      if (raceCheck) throw new Error("USERNAME_TAKEN");

      db.prepare(
        `INSERT INTO companies (id, name, currency, currency_symbol, invoice_prefix, date_format, timezone, low_stock_threshold, next_invoice_seq, developer_name)
         VALUES (?, ?, 'PKR', ?, 'INV', 'DD-MM-YYYY', 'Asia/Karachi', 25, 1, ?)`
      ).run(companyId, companyName.trim(), (currencySymbol || "Rs.").trim(), companyName.trim());

      db.prepare(
        "INSERT INTO users (id, company_id, name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, 'SUPER_ADMIN')"
      ).run(adminId, companyId, adminName.trim(), username.trim(), email?.trim() || "", bcrypt.hashSync(password, 10));
    });

    try {
      txn();
    } catch (e) {
      if (e.message === "USERNAME_TAKEN") return fail(res, "That username is already taken. Please choose another.", 409);
      throw e;
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(adminId);
    logAudit({
      user,
      action: "Created company account",
      entity: "company",
      entityId: companyId,
      details: { companyName: companyName.trim() },
    });

    // Log the new admin straight in — no need to make them re-enter the
    // password they just chose on a separate login screen.
    const accessToken = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_ACCESS_SECRET || "dev_secret", {
      expiresIn: "8h",
    });
    const refreshToken = jwt.sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET || "dev_refresh_secret", {
      expiresIn: "30d",
    });

    const { password_hash, ...safeUser } = user;
    ok(res, { user: safeUser, warehouses: [], accessToken, refreshToken }, 201);
  })
);

export default router;
