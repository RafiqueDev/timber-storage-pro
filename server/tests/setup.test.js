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

// This test file needs its OWN database (separate from api.test.js's),
// since the whole point is to verify behavior starting from zero users —
// api.test.js's shared instance already has users seeded into it.
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

async function post(url, body) {
  const res = await fetch(baseUrl + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function get(url) {
  const res = await fetch(baseUrl + url);
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

  // None of these bad attempts should have flipped initialization state.
  const status = await get("/setup/status");
  assert.equal(status.data.data.initialized, false);
});

test("setup creates the company + admin and logs straight in", async () => {
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

test("the system now reports itself as initialized, and setup is permanently refused", async () => {
  const status = await get("/setup/status");
  assert.equal(status.data.data.initialized, true);

  const secondAttempt = await post("/setup", {
    companyName: "Some Other Co",
    adminName: "Intruder",
    username: "hacker",
    password: "whatever1",
  });
  assert.equal(secondAttempt.status, 403);
  assert.match(secondAttempt.data.message, /already been set up/i);
});

test("the account created by setup can log in normally afterward", async () => {
  const login = await post("/auth/login", { username: "jane", password: "secretpass" });
  assert.equal(login.status, 200);
  assert.equal(login.data.data.user.role, "SUPER_ADMIN");
});

test("no demo data was created — only the one admin account exists", async () => {
  const login = await post("/auth/login", { username: "jane", password: "secretpass" });
  const token = login.data.data.accessToken;
  const res = await fetch(baseUrl + "/warehouses", { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  assert.deepEqual(data.data, [], "a freshly set-up system must have zero warehouses");
});
