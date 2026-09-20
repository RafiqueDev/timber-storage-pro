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
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
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
  company_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
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
  credit_remaining REAL,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);

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
  company_id TEXT NOT NULL,
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
  company_id TEXT,
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
  company_id TEXT NOT NULL,
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

// --- Multi-tenant migration (existing single-tenant installs) ---
// Older installs had exactly one company row with id='default' and no
// company_id on users/parties/containers/loading_logs/invoices/payments/
// audit_logs/party_portal_access. Backfill those columns to 'default' so an
// upgrade doesn't orphan existing data — every pre-existing row becomes
// owned by the 'default' company, which continues to work exactly as before.
addColumnIfMissing("users", "company_id", "TEXT");
addColumnIfMissing("parties", "company_id", "TEXT");
addColumnIfMissing("containers", "company_id", "TEXT");
addColumnIfMissing("loading_logs", "company_id", "TEXT");
addColumnIfMissing("invoices", "company_id", "TEXT");
addColumnIfMissing("payments", "company_id", "TEXT");
addColumnIfMissing("audit_logs", "company_id", "TEXT");
addColumnIfMissing("party_portal_access", "company_id", "TEXT");

const hasDefaultCompany = db.prepare("SELECT id FROM companies WHERE id = 'default'").get();
if (hasDefaultCompany) {
  db.prepare("UPDATE users SET company_id = 'default' WHERE company_id IS NULL").run();
  db.prepare("UPDATE parties SET company_id = 'default' WHERE company_id IS NULL").run();
  db.prepare("UPDATE containers SET company_id = 'default' WHERE company_id IS NULL").run();
  db.prepare("UPDATE loading_logs SET company_id = 'default' WHERE company_id IS NULL").run();
  db.prepare("UPDATE invoices SET company_id = 'default' WHERE company_id IS NULL").run();
  db.prepare("UPDATE payments SET company_id = 'default' WHERE company_id IS NULL").run();
  db.prepare("UPDATE audit_logs SET company_id = 'default' WHERE company_id IS NULL").run();
  db.prepare("UPDATE party_portal_access SET company_id = 'default' WHERE company_id IS NULL").run();
}

// --- Drop the legacy GLOBAL unique constraint on invoices.invoice_number ---
// The original single-tenant schema declared `invoice_number TEXT UNIQUE`
// directly on the column. That's wrong once multiple companies exist: each
// company generates its own sequence starting at 1, so two companies both
// legitimately produce "INV-2026-000001" and the second insert would fail
// with a UNIQUE constraint error. A column-level constraint can't be
// dropped with ALTER TABLE in SQLite, so for existing databases we rebuild
// the table without it, preserving every row, then re-create the correct
// per-company unique index. Fresh installs already get the right shape from
// the CREATE TABLE above and skip this entirely.
const invoicesTableSql =
  db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'").get()?.sql || "";
if (/invoice_number\s+TEXT\s+UNIQUE/i.test(invoicesTableSql)) {
  const rebuild = db.transaction(() => {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE invoices_new (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        party_id TEXT NOT NULL,
        invoice_date TEXT NOT NULL,
        billing_period_start TEXT NOT NULL,
        billing_period_end TEXT NOT NULL,
        subtotal REAL NOT NULL,
        paid_amount REAL DEFAULT 0,
        balance REAL NOT NULL,
        status TEXT DEFAULT 'Generated',
        type TEXT DEFAULT 'Invoice',
        adjustment_for TEXT,
        adjustment_reason TEXT,
        credit_remaining REAL,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO invoices_new (id, company_id, invoice_number, warehouse_id, party_id, invoice_date,
        billing_period_start, billing_period_end, subtotal, paid_amount, balance, status, type,
        adjustment_for, adjustment_reason, credit_remaining, created_by, created_at, updated_at)
      SELECT id, COALESCE(company_id,'default'), invoice_number, warehouse_id, party_id, invoice_date,
        billing_period_start, billing_period_end, subtotal, paid_amount, balance, status,
        COALESCE(type,'Invoice'), adjustment_for, adjustment_reason, credit_remaining, created_by,
        created_at, updated_at
      FROM invoices;
    `);
    db.exec("DROP TABLE invoices");
    db.exec("ALTER TABLE invoices_new RENAME TO invoices");
    db.exec("CREATE INDEX IF NOT EXISTS idx_invoice_number ON invoices(invoice_number)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_adjustment_for ON invoices(adjustment_for)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id)");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_number_per_company ON invoices(company_id, invoice_number)");
    db.exec("PRAGMA foreign_keys = ON");
  });
  rebuild();
}

// --- Company-scoped indexes ---
// Created here, AFTER the ALTER TABLE migrations above, because on a legacy
// single-tenant database the company_id columns these reference don't exist
// until those migrations have run. Fresh installs reach this point with the
// columns already present from the CREATE TABLE block, so either path ends
// up with exactly the same set of indexes.
db.exec(`
CREATE INDEX IF NOT EXISTS idx_parties_company ON parties(company_id);
CREATE INDEX IF NOT EXISTS idx_containers_company ON containers(company_id);
CREATE INDEX IF NOT EXISTS idx_loading_company ON loading_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_adjustment_for ON invoices(adjustment_for);
CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_logs(company_id);
-- Invoice numbers are unique per-company, not globally: two different
-- companies each generate their own sequence starting at 1, so
-- "INV-2026-000001" legitimately exists once per company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_number_per_company ON invoices(company_id, invoice_number);
`);

export default db;
