import Database from "better-sqlite3";
import dotenv from "dotenv";
dotenv.config();

const db = new Database(process.env.DB_FILE || "./timber.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// SCHEMA
// One source of truth for structure. All money figures stored as integers
// (paisa/cents) would be ideal, but for simplicity + decimal-safe rounding we
// store REAL and round to 2dp everywhere rent is computed (see billing.js).
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT,
  currency TEXT DEFAULT 'PKR',
  currency_symbol TEXT DEFAULT 'Rs.',
  invoice_prefix TEXT DEFAULT 'INV',
  date_format TEXT DEFAULT 'DD-MM-YYYY',
  timezone TEXT DEFAULT 'Asia/Karachi',
  low_stock_threshold INTEGER DEFAULT 25,
  next_invoice_seq INTEGER DEFAULT 1,
  developer_name TEXT DEFAULT 'Timber Storage Pro Dev Team',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  branch_address TEXT,
  location TEXT,
  contact_number TEXT,
  status TEXT DEFAULT 'Active', -- Active | Inactive
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL, -- SUPER_ADMIN | BRANCH_MANAGER | STAFF
  status TEXT DEFAULT 'Active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_warehouses (
  user_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  PRIMARY KEY (user_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  party_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  alternate_phone TEXT,
  address TEXT,
  notes TEXT,
  status TEXT DEFAULT 'Active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  container_number TEXT NOT NULL,
  date_of_unloading TEXT NOT NULL,
  initial_packets INTEGER NOT NULL,
  loaded_packets INTEGER DEFAULT 0,
  rent_type TEXT NOT NULL, -- Daily | Monthly
  rent_rate REAL NOT NULL,
  status TEXT DEFAULT 'Active', -- Active | Cleared
  notes TEXT,
  created_by TEXT,
  last_loading_date TEXT, -- date of the most recent loading activity; set when cleared to mark the exact finish date
  cleared_at TEXT, -- timestamp the container was marked Cleared (auto or manual)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_container_number ON containers(warehouse_id, container_number);
CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status);
CREATE INDEX IF NOT EXISTS idx_containers_party ON containers(party_id);
CREATE INDEX IF NOT EXISTS idx_containers_unload_date ON containers(date_of_unloading);

CREATE TABLE IF NOT EXISTS loading_logs (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  date_of_loading TEXT NOT NULL,
  packets_loaded INTEGER NOT NULL,
  vehicle_number TEXT,
  driver_number TEXT,
  description TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loading_date ON loading_logs(date_of_loading);
CREATE INDEX IF NOT EXISTS idx_loading_container ON loading_logs(container_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  warehouse_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  billing_period_start TEXT NOT NULL,
  billing_period_end TEXT NOT NULL,
  subtotal REAL NOT NULL,
  paid_amount REAL DEFAULT 0,
  balance REAL NOT NULL,
  status TEXT DEFAULT 'Generated', -- Draft|Generated|Partially Paid|Paid|Cancelled
  type TEXT DEFAULT 'Invoice', -- Invoice | CreditNote
  adjustment_for TEXT, -- invoice_id this credit note corrects, if type = CreditNote
  adjustment_reason TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);
CREATE INDEX IF NOT EXISTS idx_invoices_adjustment_for ON invoices(adjustment_for);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  container_number TEXT NOT NULL,
  arrival_date TEXT NOT NULL,
  billing_start TEXT NOT NULL,
  billing_end TEXT NOT NULL,
  billable_days INTEGER NOT NULL,
  rent_type TEXT NOT NULL,
  rent_rate REAL NOT NULL,
  calculated_rent REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  payment_method TEXT DEFAULT 'Cash', -- Cash|Bank Transfer|Other|Credit Note
  reference TEXT,
  notes TEXT,
  received_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- Tracks exactly which credit note paid down which future invoice, and how
-- much, so a banked adjustment's usage is fully auditable even though it's
-- applied automatically the next time that party is billed.
CREATE TABLE IF NOT EXISTS credit_applications (
  id TEXT PRIMARY KEY,
  credit_note_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  payment_id TEXT,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_applications_credit_note ON credit_applications(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_credit_applications_invoice ON credit_applications(invoice_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  warehouse_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT DEFAULT 'info',
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- One row per generated Party Portal access grant. A new grant replaces any
-- prior one for the same party (only the latest is ever valid) and always
-- expires after 24 hours — both the magic link token and the username/
-- password pair share that same expiry.
CREATE TABLE IF NOT EXISTS party_portal_access (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portal_access_party ON party_portal_access(party_id);
CREATE INDEX IF NOT EXISTS idx_portal_access_token ON party_portal_access(token);
`);

// ---------------------------------------------------------------------------
// LIGHTWEIGHT MIGRATIONS
// This project ships one CREATE-TABLE schema (above) for fresh installs, but
// if you're upgrading an existing timber.db from an earlier version of this
// app, these guarded ALTERs backfill the newer columns without wiping data.
// ---------------------------------------------------------------------------
function columnExists(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}
function addColumnIfMissing(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing("containers", "last_loading_date", "TEXT");
addColumnIfMissing("containers", "cleared_at", "TEXT");
addColumnIfMissing("companies", "developer_name", "TEXT DEFAULT 'Timber Storage Pro Dev Team'");
addColumnIfMissing("invoices", "type", "TEXT DEFAULT 'Invoice'");
addColumnIfMissing("invoices", "adjustment_for", "TEXT");
addColumnIfMissing("invoices", "adjustment_reason", "TEXT");
addColumnIfMissing("invoices", "credit_remaining", "REAL");

export default db;
