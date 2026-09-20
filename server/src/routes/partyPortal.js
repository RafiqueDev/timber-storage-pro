import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { nanoid, customAlphabet } from "nanoid";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate, authorizeRole } from "../middleware/auth.js";
import { authenticatePortal } from "../middleware/portalAuth.js";
import { logAudit } from "../services/audit.js";
import { calculateContainerRent, billingReferenceDate, daysBetween } from "../services/billing.js";

const router = Router();

const ACCESS_HOURS = 24;
const genPassword = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789", 10);
const genUsernameSuffix = customAlphabet("0123456789", 4);

function slugify(name) {
  return (name || "party")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12) || "party";
}

// ---------------------------------------------------------------------------
// ADMIN-FACING: manage portal access grants. Restricted to Super Admin and
// Branch Manager. Every route here is scoped to the requester's own
// company_id: an admin can only ever generate, revoke, or list portal
// access for parties that belong to their own company.
// ---------------------------------------------------------------------------
router.get(
  "/",
  authenticate,
  authorizeRole("SUPER_ADMIN", "BRANCH_MANAGER"),
  asyncHandler(async (req, res) => {
    const parties = db.prepare("SELECT * FROM parties WHERE company_id = ? ORDER BY party_name").all(req.companyId);
    const rows = parties.map((p) => {
      const access = db
        .prepare("SELECT * FROM party_portal_access WHERE party_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(p.id);
      let accessStatus = "none";
      if (access) {
        const expired = new Date(access.expires_at).getTime() < Date.now();
        accessStatus = access.revoked ? "revoked" : expired ? "expired" : "active";
      }
      return {
        party_id: p.id,
        party_name: p.party_name,
        phone: p.phone,
        access: access
          ? { id: access.id, username: access.username, expires_at: access.expires_at, last_accessed_at: access.last_accessed_at, status: accessStatus }
          : null,
      };
    });
    ok(res, rows);
  })
);

router.post(
  "/:partyId/generate",
  authenticate,
  authorizeRole("SUPER_ADMIN", "BRANCH_MANAGER"),
  asyncHandler(async (req, res) => {
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(req.params.partyId);
    if (!party || party.company_id !== req.companyId) return fail(res, "Party not found.", 404);

    db.prepare("UPDATE party_portal_access SET revoked = 1 WHERE party_id = ? AND revoked = 0").run(party.id);

    const username = `${slugify(party.party_name)}${genUsernameSuffix()}`;
    const password = genPassword();
    const token = nanoid(28);
    const expiresAt = new Date(Date.now() + ACCESS_HOURS * 60 * 60 * 1000).toISOString();
    const id = nanoid();

    db.prepare(
      `INSERT INTO party_portal_access (id, company_id, party_id, username, password_hash, token, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.companyId, party.id, username, bcrypt.hashSync(password, 10), token, expiresAt, req.user.id);

    logAudit({ user: req.user, action: "Generated party portal access", entity: "party", entityId: party.id, details: { party_name: party.party_name, username } });

    const link = `${process.env.PORTAL_BASE_URL || ""}/portal/${token}`;
    const shareMessage = `Hello ${party.party_name}, here is your Timber Storage Pro portal access (valid for 24 hours):\n\nLink: ${link}\nUsername: ${username}\nPassword: ${password}\n\nYou can view your containers, invoices and payment history any time using this link.`;
    const phoneDigits = (party.phone || "").replace(/\D/g, "");
    const whatsappUrl = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(shareMessage)}`;

    ok(res, { username, password, token, link, expiresAt, shareMessage, whatsappUrl }, 201);
  })
);

router.post(
  "/:partyId/revoke",
  authenticate,
  authorizeRole("SUPER_ADMIN", "BRANCH_MANAGER"),
  asyncHandler(async (req, res) => {
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(req.params.partyId);
    if (!party || party.company_id !== req.companyId) return fail(res, "Party not found.", 404);
    db.prepare("UPDATE party_portal_access SET revoked = 1 WHERE party_id = ? AND revoked = 0").run(party.id);
    logAudit({ user: req.user, action: "Revoked party portal access", entity: "party", entityId: party.id, details: { party_name: party.party_name } });
    ok(res, { revoked: true });
  })
);

// ---------------------------------------------------------------------------
// PORTAL-FACING: no admin auth. Isolation here doesn't rely on company_id —
// a login/magic-link always resolves to exactly one party_portal_access row
// via a globally unique username or token, already scoped to one party.
// ---------------------------------------------------------------------------
function issuePortalToken(access) {
  const secondsRemaining = Math.max(1, Math.floor((new Date(access.expires_at).getTime() - Date.now()) / 1000));
  return jwt.sign({ accessId: access.id, aud: "party-portal" }, process.env.PORTAL_JWT_SECRET || "dev_portal_secret_change_me", {
    expiresIn: secondsRemaining,
  });
}

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return fail(res, "Username and password are required.", 400);
    const access = db.prepare("SELECT * FROM party_portal_access WHERE username = ? AND revoked = 0").get(username.trim());
    if (!access) return fail(res, "Invalid username or password.", 401);
    if (new Date(access.expires_at).getTime() < Date.now()) return fail(res, "This access has expired. Please ask for a new link.", 401);
    if (!bcrypt.compareSync(password, access.password_hash)) return fail(res, "Invalid username or password.", 401);

    db.prepare("UPDATE party_portal_access SET last_accessed_at = datetime('now') WHERE id = ?").run(access.id);
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(access.party_id);
    ok(res, { token: issuePortalToken(access), party: { id: party.id, party_name: party.party_name }, expiresAt: access.expires_at });
  })
);

router.get(
  "/verify/:token",
  asyncHandler(async (req, res) => {
    const access = db.prepare("SELECT * FROM party_portal_access WHERE token = ? AND revoked = 0").get(req.params.token);
    if (!access) return fail(res, "This link is invalid or has been revoked.", 404);
    if (new Date(access.expires_at).getTime() < Date.now()) return fail(res, "This link has expired. Please ask for a new one.", 401);

    db.prepare("UPDATE party_portal_access SET last_accessed_at = datetime('now') WHERE id = ?").run(access.id);
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(access.party_id);
    ok(res, { token: issuePortalToken(access), party: { id: party.id, party_name: party.party_name }, expiresAt: access.expires_at });
  })
);

router.get(
  "/me",
  authenticatePortal,
  asyncHandler(async (req, res) => {
    const party = req.portalParty;
    const containers = db.prepare("SELECT * FROM containers WHERE party_id = ? ORDER BY created_at DESC").all(party.id);
    const today = new Date().toISOString().slice(0, 10);
    const enrichedContainers = containers.map((c) => {
      const referenceEnd = billingReferenceDate(c, today);
      const days = daysBetween(c.date_of_unloading, referenceEnd);
      const accruedRent = calculateContainerRent({ rentType: c.rent_type, rentRate: c.rent_rate, billableDays: days });
      return { ...c, remaining_packets: c.initial_packets - c.loaded_packets, accrued_rent: accruedRent };
    });

    const invoices = db
      .prepare("SELECT i.*, w.branch_name FROM invoices i JOIN warehouses w ON w.id = i.warehouse_id WHERE i.party_id = ? ORDER BY i.invoice_date DESC")
      .all(party.id);
    const invoiceIds = invoices.map((i) => i.id);
    let payments = [];
    let items = [];
    if (invoiceIds.length) {
      const placeholders = invoiceIds.map(() => "?").join(",");
      payments = db.prepare(`SELECT * FROM payments WHERE invoice_id IN (${placeholders}) ORDER BY payment_date DESC`).all(...invoiceIds);
      items = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id IN (${placeholders})`).all(...invoiceIds);
    }
    const itemsByInvoice = items.reduce((acc, item) => {
      (acc[item.invoice_id] = acc[item.invoice_id] || []).push(item);
      return acc;
    }, {});
    const invoicesWithItems = invoices.map((i) => ({ ...i, items: itemsByInvoice[i.id] || [] }));

    const availableCredit =
      db.prepare("SELECT COALESCE(SUM(credit_remaining),0) s FROM invoices WHERE party_id = ? AND type = 'CreditNote' AND status != 'Cancelled'").get(party.id).s || 0;
    const outstanding = invoices.reduce((s, i) => s + i.balance, 0);
    const company = db.prepare("SELECT name, currency_symbol, logo FROM companies WHERE id = ?").get(party.company_id);

    ok(res, {
      party,
      company,
      containers: enrichedContainers,
      invoices: invoicesWithItems,
      payments,
      availableCredit,
      outstandingBalance: outstanding,
      totalContainers: containers.length,
      activeContainers: containers.filter((c) => c.status === "Active").length,
      clearedContainers: containers.filter((c) => c.status === "Cleared").length,
      expiresAt: req.portalAccess.expires_at,
    });
  })
);

export default router;
