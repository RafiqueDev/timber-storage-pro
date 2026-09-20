import fs from "node:fs";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import db from "./db.js";

/**
 * CLI equivalent of the in-browser Setup screen: creates a brand new
 * company + exactly one Super Admin account for it. No demo warehouses,
 * parties, containers, or invoices — unlike seed.js, which is for trying
 * the app out with sample data.
 *
 * This is multi-tenant: running it does NOT wipe or touch any existing
 * company's data. It only ever adds a new, completely isolated company —
 * the same as clicking "Create Account" on the login screen. Run it as many
 * times as you have real companies to onboard.
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
  console.log("\nTimber Storage Pro — Create a New Company Account\n" + "-".repeat(40));
  console.log("This adds a brand new, fully isolated company + its own admin login.");
  console.log("It does NOT touch any other company already in this database.\n");

  const companyName = ask("Company / business name: ");
  const currencySymbol = ask("Currency symbol (default: Rs.): ", { required: false }) || "Rs.";

  console.log("\nNow create the admin login for this company:");
  const adminName = ask("Your full name: ");
  let username;
  while (true) {
    username = ask("Choose a username: ");
    if (username.length < 3) {
      console.log("  Username must be at least 3 characters.");
      continue;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      console.log("  Username can only contain letters, numbers, dots, hyphens, and underscores.");
      continue;
    }
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      console.log("  That username is already taken (usernames are unique across every company on this install). Try another.");
      continue;
    }
    break;
  }
  let password;
  while (true) {
    password = ask("Choose a password (min 6 characters): ");
    if (password.length >= 6) break;
    console.log("  Password must be at least 6 characters.");
  }

  const companyId = nanoid();
  const adminId = nanoid();

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO companies (id, name, currency, currency_symbol, invoice_prefix, date_format, timezone, low_stock_threshold, next_invoice_seq, developer_name)
       VALUES (?, ?, 'PKR', ?, 'INV', 'DD-MM-YYYY', 'Asia/Karachi', 25, 1, ?)`
    ).run(companyId, companyName, currencySymbol, companyName);

    db.prepare("INSERT INTO users (id, company_id, name, username, email, password_hash, role) VALUES (?, ?, ?, ?, '', ?, 'SUPER_ADMIN')").run(
      adminId,
      companyId,
      adminName,
      username,
      bcrypt.hashSync(password, 10)
    );
    // Deliberately no warehouses, parties, or containers — you create your
    // own from inside the app (Admin > Warehouses is the very first step).
  });

  txn();

  console.log("\n" + "=".repeat(40));
  console.log(`Company "${companyName}" created.`);
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
