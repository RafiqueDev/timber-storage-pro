import { nanoid } from "nanoid";
import db from "../db.js";

/**
 * Central notification dispatcher (spec #57-58). Called from routes that
 * cause an event a user should be alerted to. Never call db inserts for
 * notifications directly from a route — go through here so behavior (who
 * gets notified for a given warehouse) stays consistent everywhere.
 */

/** All Super Admins in the same company as warehouseId + any user assigned to warehouseId. */
function recipientsFor(warehouseId) {
  if (!warehouseId) return [];
  const warehouse = db.prepare("SELECT company_id FROM warehouses WHERE id = ?").get(warehouseId);
  if (!warehouse) return [];
  const admins = db
    .prepare("SELECT id FROM users WHERE role='SUPER_ADMIN' AND status='Active' AND company_id = ?")
    .all(warehouse.company_id);
  const assigned = db
    .prepare(
      `SELECT u.id FROM users u
       JOIN user_warehouses uw ON uw.user_id = u.id
       WHERE uw.warehouse_id = ? AND u.status='Active' AND u.role != 'SUPER_ADMIN'`
    )
    .all(warehouseId);
  const ids = new Set([...admins.map((a) => a.id), ...assigned.map((a) => a.id)]);
  return [...ids];
}

export function notify({ warehouseId, title, body, type = "info", excludeUserId }) {
  const recipients = recipientsFor(warehouseId).filter((id) => id !== excludeUserId);
  const stmt = db.prepare(
    "INSERT INTO notifications (id, user_id, title, body, type, read) VALUES (?, ?, ?, ?, ?, 0)"
  );
  for (const userId of recipients) {
    stmt.run(nanoid(), userId, title, body || "", type);
  }
}

export function notifyLowStock(container) {
  notify({
    warehouseId: container.warehouse_id,
    title: `Low stock: ${container.container_number}`,
    body: `Only ${container.initial_packets - container.loaded_packets} bundles remaining.`,
    type: "warning",
  });
}

export function notifyInvoiceGenerated(invoice, excludeUserId) {
  notify({
    warehouseId: invoice.warehouse_id,
    title: `Invoice ${invoice.invoice_number} generated`,
    body: `Amount due: Rs. ${invoice.subtotal.toLocaleString()}`,
    type: "info",
    excludeUserId,
  });
}

export function notifyPaymentReceived(payment, invoice, excludeUserId) {
  notify({
    warehouseId: invoice.warehouse_id,
    title: `Payment received for ${invoice.invoice_number}`,
    body: `Rs. ${payment.amount.toLocaleString()} via ${payment.payment_method}`,
    type: "success",
    excludeUserId,
  });
}

export function notifyContainerCleared(container, excludeUserId) {
  notify({
    warehouseId: container.warehouse_id,
    title: `Container cleared: ${container.container_number}`,
    body: "All bundles have been loaded out.",
    type: "success",
    excludeUserId,
  });
}
