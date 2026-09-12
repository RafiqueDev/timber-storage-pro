import jwt from "jsonwebtoken";
import db from "../db.js";
import { fail } from "../utils/response.js";

/**
 * Completely separate auth path from the main app's `authenticate`
 * middleware — different secret, different token shape, different table.
 * A portal token can NEVER be used against admin routes (wrong secret,
 * verification just fails) and an admin token can never be used here
 * either. On top of the JWT's own expiry, this also re-checks the
 * underlying access grant on every request (not revoked, not past its
 * 24-hour window) so an admin revoking access cuts a party off immediately
 * even mid-session, rather than waiting for the token to expire on its own.
 */
export function authenticatePortal(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return fail(res, "Portal session required.", 401);

  let payload;
  try {
    payload = jwt.verify(token, process.env.PORTAL_JWT_SECRET || "dev_portal_secret_change_me");
  } catch {
    return fail(res, "Your portal session has expired. Please use your link again.", 401);
  }
  if (payload.aud !== "party-portal") return fail(res, "Invalid portal session.", 401);

  const access = db.prepare("SELECT * FROM party_portal_access WHERE id = ?").get(payload.accessId);
  if (!access || access.revoked) return fail(res, "This portal access has been revoked.", 401);
  if (new Date(access.expires_at).getTime() < Date.now()) {
    return fail(res, "This portal link has expired. Please ask for a new one.", 401);
  }

  const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(access.party_id);
  if (!party) return fail(res, "Party not found.", 404);

  req.portalAccess = access;
  req.portalParty = party;
  next();
}
