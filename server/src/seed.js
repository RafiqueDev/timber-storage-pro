import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import db from "./db.js";

function iso(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// The seeded demo tenant always uses this literal id — just a normal
// company_id like any other, kept stable for predictability across resets.
const COMPANY_ID = "default";

const txn = db.transaction(() => {
  db.prepare("DELETE FROM credit_applications").run();
  db.prepare("DELETE FROM party_portal_access").run();
  db.prepare("DELETE FROM notifications").run();
  db.prepare("DELETE FROM payments").run();
  db.prepare("DELETE FROM invoice_items").run();
  db.prepare("DELETE FROM invoices").run();
  db.prepare("DELETE FROM loading_logs").run();
  db.prepare("DELETE FROM containers").run();
  db.prepare("DELETE FROM parties").run();
  db.prepare("DELETE FROM user_warehouses").run();
  db.prepare("DELETE FROM users").run();
  db.prepare("DELETE FROM warehouses").run();
  db.prepare("DELETE FROM audit_logs").run();
  db.prepare("DELETE FROM companies").run();

  db.prepare(
    `INSERT INTO companies (id, name, currency, currency_symbol, invoice_prefix, date_format, timezone, low_stock_threshold, next_invoice_seq)
     VALUES (?, 'Timber Storage Pro', 'PKR', 'Rs.', 'INV', 'DD-MM-YYYY', 'Asia/Karachi', 25, 1)`
  ).run(COMPANY_ID);

  const warehouses = [
    { name: "Main Terminal Yard", address: "Timber Market Rd, Karachi", location: "Karachi", contact: "021-1112222" },
    { name: "East Terminal", address: "East Wharf, Karachi", location: "Karachi", contact: "021-3334444" },
    { name: "North Warehouse", address: "Ring Road, Lahore", location: "Lahore", contact: "042-5556666" },
  ].map((w) => {
    const id = nanoid();
    db.prepare(
      "INSERT INTO warehouses (id, company_id, branch_name, branch_address, location, contact_number) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, COMPANY_ID, w.name, w.address, w.location, w.contact);
    return { id, ...w };
  });

  const admin = { id: nanoid(), name: "Ahmed Khan", username: "admin", role: "SUPER_ADMIN" };
  db.prepare("INSERT INTO users (id, company_id, name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    admin.id,
    COMPANY_ID,
    admin.name,
    admin.username,
    "admin@timberstoragepro.com",
    bcrypt.hashSync("admin123", 10),
    admin.role
  );

  const manager = { id: nanoid(), name: "Bilal Hussain", username: "manager", role: "BRANCH_MANAGER" };
  db.prepare("INSERT INTO users (id, company_id, name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    manager.id,
    COMPANY_ID,
    manager.name,
    manager.username,
    "bilal@timberstoragepro.com",
    bcrypt.hashSync("manager123", 10),
    manager.role
  );
  db.prepare("INSERT INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)").run(manager.id, warehouses[0].id);

  const staff = { id: nanoid(), name: "Sara Ali", username: "staff", role: "STAFF" };
  db.prepare("INSERT INTO users (id, company_id, name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    staff.id,
    COMPANY_ID,
    staff.name,
    staff.username,
    "sara@timberstoragepro.com",
    bcrypt.hashSync("staff123", 10),
    staff.role
  );
  db.prepare("INSERT INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)").run(staff.id, warehouses[0].id);

  const parties = ["ABC Timber", "XYZ Wood Traders", "City Timber", "Riverside Lumber Co."].map((name, i) => {
    const id = nanoid();
    db.prepare(
      "INSERT INTO parties (id, company_id, party_name, contact_person, phone, address) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, COMPANY_ID, name, `Contact Person ${i + 1}`, `030${i}1234567`, `Business District, ${warehouses[i % warehouses.length].location}`);
    return { id, name };
  });

  const containers = [];
  let cNum = 1;
  for (const wh of warehouses) {
    for (let i = 0; i < 3; i++) {
      const party = parties[(cNum + i) % parties.length];
      const id = nanoid();
      const unloadDaysAgo = 15 + i * 10;
      const initial = 300 + i * 150;
      const rentType = i % 2 === 0 ? "Daily" : "Monthly";
      const rate = rentType === "Daily" ? 500 : 15000;
      db.prepare(
        `INSERT INTO containers (id, company_id, warehouse_id, party_id, container_number, date_of_unloading, initial_packets, loaded_packets, rent_type, rent_rate, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'Active')`
      ).run(id, COMPANY_ID, wh.id, party.id, `CONT-${String(cNum).padStart(3, "0")}`, iso(unloadDaysAgo), initial, rentType, rate);
      containers.push({ id, warehouseId: wh.id, partyId: party.id, initial, unloadDaysAgo, containerNumber: `CONT-${String(cNum).padStart(3, "0")}` });
      cNum++;
    }
  }

  // Some loading history on the first container of each warehouse
  for (const c of containers.filter((_, idx) => idx % 3 === 0)) {
    const loaded = Math.floor(c.initial * 0.3);
    db.prepare(
      `INSERT INTO loading_logs (id, company_id, container_id, warehouse_id, party_id, date_of_loading, packets_loaded, vehicle_number, driver_number, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), COMPANY_ID, c.id, c.warehouseId, c.partyId, iso(5), loaded, "TLB-4521", "0301-2223334", "Regular dispatch", admin.id);
    db.prepare("UPDATE containers SET loaded_packets = loaded_packets + ? WHERE id=?").run(loaded, c.id);
  }

  // One sample invoice + partial payment on the Main Terminal Yard's first container
  const sampleContainer = containers[0];
  const container = db.prepare("SELECT * FROM containers WHERE id=?").get(sampleContainer.id);
  const days = sampleContainer.unloadDaysAgo - 2;
  const rent = container.rent_type === "Daily" ? days * container.rent_rate : (container.rent_rate / 30) * days;
  const invoiceId = nanoid();
  db.prepare(
    `INSERT INTO invoices (id, company_id, invoice_number, warehouse_id, party_id, invoice_date, billing_period_start, billing_period_end, subtotal, paid_amount, balance, status, created_by)
     VALUES (?, ?, 'INV-2026-000001', ?, ?, ?, ?, ?, ?, ?, ?, 'Partially Paid', ?)`
  ).run(invoiceId, COMPANY_ID, container.warehouse_id, container.party_id, iso(2), container.date_of_unloading, iso(2), rent, rent * 0.4, rent * 0.6, admin.id);
  db.prepare(
    `INSERT INTO invoice_items (id, invoice_id, container_id, container_number, arrival_date, billing_start, billing_end, billable_days, rent_type, rent_rate, calculated_rent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(nanoid(), invoiceId, container.id, container.container_number, container.date_of_unloading, container.date_of_unloading, iso(2), days, container.rent_type, container.rent_rate, rent);
  db.prepare(
    `INSERT INTO payments (id, company_id, invoice_id, party_id, warehouse_id, amount, payment_date, payment_method, reference, received_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Bank Transfer', 'TRX-9911', ?)`
  ).run(nanoid(), COMPANY_ID, invoiceId, container.party_id, container.warehouse_id, rent * 0.4, iso(1), admin.id);
  db.prepare("UPDATE companies SET next_invoice_seq = 2 WHERE id = ?").run(COMPANY_ID);

  console.log("Seed complete.");
  console.log("Login with: admin / admin123  (Super Admin)");
  console.log("            manager / manager123  (Branch Manager - Main Terminal Yard)");
  console.log("            staff / staff123  (Staff - Main Terminal Yard)");
});

txn();
