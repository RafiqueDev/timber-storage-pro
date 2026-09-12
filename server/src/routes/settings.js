import { Router } from "express";
import db from "../db.js";
import { ok, asyncHandler } from "../utils/response.js";
import { authenticate, authorizeRole } from "../middleware/auth.js";
import { logAudit } from "../services/audit.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    ok(res, db.prepare("SELECT * FROM companies WHERE id='default'").get());
  })
);

router.put(
  "/",
  authorizeRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const c = db.prepare("SELECT * FROM companies WHERE id='default'").get();
    const { name, currency, currency_symbol, invoice_prefix, date_format, timezone, low_stock_threshold, logo, developer_name } = req.body;
    db.prepare(
      `UPDATE companies SET name=?, currency=?, currency_symbol=?, invoice_prefix=?, date_format=?, timezone=?, low_stock_threshold=?, logo=?, developer_name=?, updated_at=datetime('now') WHERE id='default'`
    ).run(
      name ?? c.name,
      currency ?? c.currency,
      currency_symbol ?? c.currency_symbol,
      invoice_prefix ?? c.invoice_prefix,
      date_format ?? c.date_format,
      timezone ?? c.timezone,
      low_stock_threshold ?? c.low_stock_threshold,
      logo ?? c.logo,
      developer_name ?? c.developer_name,
    );
    logAudit({ user: req.user, action: "Updated system settings" });
    ok(res, db.prepare("SELECT * FROM companies WHERE id='default'").get());
  })
);

export default router;
