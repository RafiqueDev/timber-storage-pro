import fs from "node:fs";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import db from "./db.js";

/**
 * Sets up a completely clean system: your company name + exactly one
 * Super Admin account. No demo warehouses, parties, containers, or
 * invoices — unlike seed.js, which is for trying the app out with sample
 * data. Run this once when you're ready to start using the app for real.
 *
 * Safe to re-run: it wipes ALL existing data first (with a confirmation
 * prompt), so use `npm run seed` instead if you just want the demo data back.
 *
 * Uses a plain synchronous stdin reader rather than the readline module —
 * deliberately, so prompts are answered strictly one at a time with no risk
 * of a later answer racing past an earlier prompt.
 */

function readLineSync() {
  const buf = Buffer.alloc(1);
  let line = "";
  while (true) {
    let bytesRead;
    try {
      bytesRead = fs.readSync(0, buf, 0, 1, null);
    } catch (err) {
      if (err.code === "EAGAIN") continue; // stdin not ready yet — retry
      throw err;
    }
    if (bytesRead === 0) return line; // EOF
    const char = buf.toString("utf8");
    if (char === "\n") return line;
    if (char !== "\r") line += char;
  }
}

function ask(promptText, { required = true } = {}) {
  while (true) {
    process.stdout.write(promptText);
    const answer = readLineSync().trim();
    if (answer || !required) return answer;
    console.log("  This field is required.");
  }
}

function main() {
  console.log("\nTimber Storage Pro — First-Time Setup\n" + "-".repeat(40));
  console.log("This creates your real company + your own admin login.");
  console.log("It will erase any existing demo/seed data first.\n");

  const confirm = ask("Type YES to continue and wipe existing data: ");
  if (confirm !== "YES") {
    console.log("Cancelled. No changes were made.");
    process.exit(0);
  }

  const companyName = ask("\nCompany / business name: ");
  const currencySymbol = ask("Currency symbol (default: Rs.): ", { required: false }) || "Rs.";

  console.log("\nNow create your own Super Admin login:");
  const adminName = ask("Your full name: ");
  const username = ask("Choose a username: ");
  let password;
  while (true) {
    password = ask("Choose a password (min 6 characters): ");
    if (password.length >= 6) break;
    console.log("  Password must be at least 6 characters.");
  }

  const txn = db.transaction(() => {
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
    ).run(companyName, currencySymbol, companyName);

    const adminId = nanoid();
    db.prepare("INSERT INTO users (id, name, username, email, password_hash, role) VALUES (?, ?, ?, '', ?, 'SUPER_ADMIN')").run(
      adminId,
      adminName,
      username,
      bcrypt.hashSync(password, 10)
    );
    // Deliberately no warehouses, parties, or containers — you create your
    // own from inside the app (Admin > Warehouses is the very first step).
  });

  txn();

  console.log("\n" + "=".repeat(40));
  console.log("Setup complete. Your system is now empty and ready to use.");
  console.log(`Log in with:  ${username} / (the password you just set)`);
  console.log("\nNext steps inside the app:");
  console.log("  1. Log in, go to Admin > Warehouses, and add your first branch.");
  console.log("  2. Go to Admin > Users to invite any other staff/managers.");
  console.log("  3. Go to Parties to add your first customer.");
  console.log("  4. Go to Containers to log your first container.");
  console.log("=".repeat(40) + "\n");
}

try {
  main();
} catch (err) {
  console.error("Setup failed:", err.message);
  process.exit(1);
}
