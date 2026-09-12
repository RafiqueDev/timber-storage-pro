import { nanoid } from "nanoid";
import db from "../db.js";

/**
 * Central audit logger. Call this from every controller that mutates data,
 * rather than duplicating logging logic across routes.
 */
export function logAudit({ user, action, entity, entityId, details, warehouseId }) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, user_id, user_name, action, entity, entity_id, details, warehouse_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    nanoid(),
    user?.id || null,
    user?.name || "System",
    action,
    entity || null,
    entityId || null,
    details ? JSON.stringify(details) : null,
    warehouseId || null
  );
}
