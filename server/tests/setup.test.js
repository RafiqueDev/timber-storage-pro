import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, "test-setup.db");

function cleanupDbFiles() {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = testDbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
cleanupDbFiles();

// This test file needs its OWN database (separate from api.test.js's), to
// verify behavior starting from a genuinely empty install.
process.env.DB_FILE = testDbPath;
process.env.JWT_ACCESS_SECRET = "setup_test_access_secret";
process.env.JWT_REFRESH_SECRET = "setup_test_refresh_secret";

const { default: app } = await import("../src/app.js");

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}/api`;
});

after(() => {
  server.close();
  cleanupDbFiles();
});

async function post(url, body, token) {
  const res = await fetch(baseUrl + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function get(url, token) {
  const res = await fetch(baseUrl + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, data: await res.json() };
}

test("a brand-new install reports itself as not initialized", async () => {
  const status = await get("/setup/status");
  assert.equal(status.status, 200);
  assert.equal(status.data.data.initialized, false);
});

test("setup rejects invalid input before touching the database", async () => {
  const noCompany = await post("/setup", { adminName: "A", username: "abc", password: "secret1" });
  assert.equal(noCompany.status, 400);
  assert.match(noCompany.data.message, /company name/i);

  const shortUsername = await post("/setup", { companyName: "Acme", adminName: "A", username: "ab", password: "secret1" });
  assert.equal(shortUsername.status, 400);

  const badUsernameChars = await post("/setup", { companyName: "Acme", adminName: "A", username: "ab cd!", password: "secret1" });
  assert.equal(badUsernameChars.status, 400);

  const shortPassword = await post("/setup", { companyName: "Acme", adminName: "A", username: "admin", password: "123" });
  assert.equal(shortPassword.status, 400);

  const badEmail = await post("/setup", { companyName: "Acme", adminName: "A", username: "admin", password: "secret1", email: "not-an-email" });
  assert.equal(badEmail.status, 400);
});

test("setup creates a company + admin and logs straight in", async () => {
  const res = await post("/setup", {
    companyName: "Acme Timber Co",
    currencySymbol: "$",
    adminName: "Jane Admin",
    username: "jane",
    email: "jane@acme.test",
    password: "secretpass",
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.data.user.username, "jane");
  assert.equal(res.data.data.user.role, "SUPER_ADMIN");
  assert.ok(res.data.data.accessToken);
  assert.ok(res.data.data.refreshToken);
  assert.deepEqual(res.data.data.warehouses, []);
});

test("the system now reports itself as initialized — but setup remains open for the NEXT company", async () => {
  const status = await get("/setup/status");
  assert.equal(status.data.data.initialized, true);

  // Multi-tenant: unlike the old single-tenant lock, a second company can
  // sign up at any time — this is the core of "add new accounts in future,
  // used by everyone with separate accounts".
  const second = await post("/setup", {
    companyName: "Second Company Ltd",
    adminName: "Second Admin",
    username: "seconduser",
    password: "secondpass1",
  });
  assert.equal(second.status, 201);
  assert.notEqual(second.data.data.user.id, undefined);
});

test("setup refuses a duplicate username even across different companies", async () => {
  const dup = await post("/setup", {
    companyName: "Yet Another Co",
    adminName: "Someone Else",
    username: "jane",
    password: "whateverpass",
  });
  assert.equal(dup.status, 409);
  assert.match(dup.data.message, /already taken/i);
});

test("the account created by setup can log in normally afterward", async () => {
  const login = await post("/auth/login", { username: "jane", password: "secretpass" });
  assert.equal(login.status, 200);
  assert.equal(login.data.data.user.role, "SUPER_ADMIN");
});

test("no demo data was created for either company, and their warehouses never overlap", async () => {
  const janeLogin = await post("/auth/login", { username: "jane", password: "secretpass" });
  const janeToken = janeLogin.data.data.accessToken;
  const janeWarehouses = await get("/warehouses", janeToken);
  assert.deepEqual(janeWarehouses.data.data, [], "a freshly set-up company must have zero warehouses");

  const secondLogin = await post("/auth/login", { username: "seconduser", password: "secondpass1" });
  const secondToken = secondLogin.data.data.accessToken;

  await post("/warehouses", { branch_name: "Jane's Only Warehouse" }, janeToken);
  const secondCompanyWarehouses = await get("/warehouses", secondToken);
  assert.deepEqual(secondCompanyWarehouses.data.data, [], "one company's new warehouse must never appear for another company");
});
