/**
 * ---------------------------------------------------------------------------
 * CENTRAL BILLING ENGINE
 * This is the ONLY place rent should ever be calculated. Dashboard, invoice
 * generation, reports and PDF all call into calculateContainerRent() so the
 * numbers can never drift apart (spec #103, #104, #122).
 * ---------------------------------------------------------------------------
 */

/** Round to 2 decimal places in a decimal-safe way (avoids float drift). */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Whole days between two ISO date strings (end - start), minimum 0. */
export function daysBetween(startDateISO, endDateISO) {
  const start = new Date(startDateISO + "T00:00:00");
  const end = new Date(endDateISO + "T00:00:00");
  const ms = end.getTime() - start.getTime();
  const d = Math.round(ms / (1000 * 60 * 60 * 24));
  return Math.max(d, 0);
}

/**
 * Default billable days for a container as of "today" (or a given date):
 * today - date_of_unloading.
 */
export function defaultBillableDays(dateOfUnloading, asOfDateISO) {
  return daysBetween(dateOfUnloading, asOfDateISO);
}

/**
 * Core rent formula.
 *  Daily:   billableDays * dailyRate
 *  Monthly: (monthlyRate / 30) * billableDays
 */
export function calculateContainerRent({ rentType, rentRate, billableDays }) {
  if (billableDays < 0) throw new Error("Billable days cannot be negative");
  if (rentType === "Daily") {
    return round2(billableDays * rentRate);
  }
  if (rentType === "Monthly") {
    return round2((rentRate / 30) * billableDays);
  }
  throw new Error(`Unknown rent type: ${rentType}`);
}

export function remainingBundles(container) {
  return container.initial_packets - container.loaded_packets;
}

/**
 * The date storage duration should be measured up to for a given container.
 *  - Active containers: still accruing rent, so measure up to "today".
 *  - Cleared containers: stop accruing the moment the last bundle left, so
 *    measure up to the last loading date (falling back to cleared_at / the
 *    unloading date for older records that predate this field).
 * This is what makes fully-loaded-out containers remain billable for their
 * final period instead of disappearing from billing once cleared.
 */
export function billingReferenceDate(container, todayISO) {
  if (container.status === "Cleared") {
    return container.last_loading_date || (container.cleared_at || "").slice(0, 10) || container.date_of_unloading;
  }
  return todayISO;
}

/**
 * Breaks a day count into whole 30-day "months" + remaining days, so the UI
 * can show e.g. "64 days = 2 months, 4 days" alongside the raw day count.
 */
export function breakdownDuration(totalDays) {
  const days = Math.max(0, Math.round(totalDays));
  const months = Math.floor(days / 30);
  const remainingDays = days - months * 30;
  return { totalDays: days, months, remainingDays };
}

/**
 * Resolves a billing "mode" against an exact day count into the actual
 * number of days to bill for. This is what powers the manual override in
 * the Billing screen — the exact number always stays editable afterward,
 * this just decides the *suggested* starting value.
 *   exact              -> bill for every day accrued (e.g. 64)
 *   round_down_months  -> drop partial-month remainder (e.g. 64 -> 60)
 *   round_up_months    -> bill the next full month too (e.g. 64 -> 90)
 */
export function daysForBillingMode(exactDays, mode = "exact") {
  const { months, remainingDays } = breakdownDuration(exactDays);
  switch (mode) {
    case "round_down_months":
      return months * 30;
    case "round_up_months":
      return remainingDays > 0 ? (months + 1) * 30 : months * 30;
    case "exact":
    default:
      return Math.max(0, Math.round(exactDays));
  }
}
