import { nanoid } from "nanoid";
import db from "../db.js";

/**
 * Central audit logger. Call this from every controller that mutates data,
 * rather than duplicating logging logic across routes. Every entry is
 * stamped with the acting user's company_id, so the Audit Logs screen (and
 * any future cross-tenant admin tooling) can never accidentally mix one
 * company's history with another's.
 */
export function logAudit({ user, action, entity, entityId, details, warehouseId, companyId }) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, company_id, user_id, user_name, action, entity, entity_id, details, warehouse_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    nanoid(),
    companyId || user?.company_id || null,
    user?.id || null,
    user?.name || "System",
    action,
    entity || null,
    entityId || null,
    details ? JSON.stringify(details) : null,
    warehouseId || null
  );
}
