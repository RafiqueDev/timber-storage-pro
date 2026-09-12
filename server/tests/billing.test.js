import { test } from "node:test";
import assert from "node:assert/strict";
import {
  round2,
  daysBetween,
  calculateContainerRent,
  remainingBundles,
  billingReferenceDate,
  breakdownDuration,
  daysForBillingMode,
} from "../src/services/billing.js";

test("daysBetween — whole days, never negative", () => {
  assert.equal(daysBetween("2026-08-01", "2026-08-26"), 25);
  assert.equal(daysBetween("2026-08-26", "2026-08-01"), 0); // clamped, never negative
  assert.equal(daysBetween("2026-08-01", "2026-08-01"), 0);
});

// Spec #111 — BILLING TEST: Daily rate 500, 20 days => 10,000
test("calculateContainerRent — Daily formula matches spec exactly", () => {
  assert.equal(calculateContainerRent({ rentType: "Daily", rentRate: 500, billableDays: 20 }), 10000);
});

// Spec #111 — Monthly rate 15,000, 20 days => 10,000
test("calculateContainerRent — Monthly formula matches spec exactly", () => {
  assert.equal(calculateContainerRent({ rentType: "Monthly", rentRate: 15000, billableDays: 20 }), 10000);
});

test("calculateContainerRent — rejects negative billable days", () => {
  assert.throws(() => calculateContainerRent({ rentType: "Daily", rentRate: 100, billableDays: -1 }));
});

test("calculateContainerRent — rejects unknown rent type", () => {
  assert.throws(() => calculateContainerRent({ rentType: "Weekly", rentRate: 100, billableDays: 5 }));
});

test("round2 — decimal-safe rounding avoids float drift", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(10 / 3), 3.33);
});

test("remainingBundles — initial minus loaded", () => {
  assert.equal(remainingBundles({ initial_packets: 500, loaded_packets: 450 }), 50);
});

// Spec #110 — CRITICAL TEST CASE: 500 initial, loads of 100+150+200=450,
// remaining 50; a further load of 60 must fail (tested at the API layer in
// api.test.js since the rejection lives in the loading route, but the
// underlying stock math itself is verified here in isolation).
test("critical test case — stock math", () => {
  let loaded = 0;
  for (const qty of [100, 150, 200]) loaded += qty;
  const remaining = remainingBundles({ initial_packets: 500, loaded_packets: loaded });
  assert.equal(remaining, 50);
  assert.ok(60 > remaining, "a 60-unit load must exceed the 50 remaining and therefore be rejected");
});

test("billingReferenceDate — Active containers measure up to today", () => {
  const container = { status: "Active", date_of_unloading: "2026-08-01" };
  assert.equal(billingReferenceDate(container, "2026-08-26"), "2026-08-26");
});

test("billingReferenceDate — Cleared containers stop at last_loading_date, not today", () => {
  const container = { status: "Cleared", last_loading_date: "2026-08-10", date_of_unloading: "2026-08-01" };
  assert.equal(billingReferenceDate(container, "2026-08-26"), "2026-08-10");
});

test("billingReferenceDate — Cleared containers fall back to cleared_at, then unload date", () => {
  const withClearedAt = { status: "Cleared", last_loading_date: null, cleared_at: "2026-08-12 10:00:00", date_of_unloading: "2026-08-01" };
  assert.equal(billingReferenceDate(withClearedAt, "2026-08-26"), "2026-08-12");

  const withNeither = { status: "Cleared", last_loading_date: null, cleared_at: null, date_of_unloading: "2026-08-01" };
  assert.equal(billingReferenceDate(withNeither, "2026-08-26"), "2026-08-01");
});

// Manual billing-period override — "2 months and 4 days" example from the requirements
test("breakdownDuration — 64 days = 2 months, 4 days", () => {
  const { months, remainingDays, totalDays } = breakdownDuration(64);
  assert.equal(months, 2);
  assert.equal(remainingDays, 4);
  assert.equal(totalDays, 64);
});

test("daysForBillingMode — exact keeps the full day count", () => {
  assert.equal(daysForBillingMode(64, "exact"), 64);
});

test("daysForBillingMode — round_down_months drops the partial month", () => {
  assert.equal(daysForBillingMode(64, "round_down_months"), 60);
});

test("daysForBillingMode — round_up_months bills the next full month", () => {
  assert.equal(daysForBillingMode(64, "round_up_months"), 90);
  assert.equal(daysForBillingMode(60, "round_up_months"), 60); // already exact, no bump needed
});
