import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { fail } from "./utils/response.js";

import authRoutes from "./routes/auth.js";
import warehouseRoutes from "./routes/warehouses.js";
import partyRoutes from "./routes/parties.js";
import containerRoutes from "./routes/containers.js";
import loadingRoutes from "./routes/loading.js";
import invoiceRoutes from "./routes/invoices.js";
import paymentRoutes from "./routes/payments.js";
import reportRoutes from "./routes/reports.js";
import userRoutes from "./routes/users.js";
import auditLogRoutes from "./routes/auditLogs.js";
import dashboardRoutes from "./routes/dashboard.js";
import settingsRoutes from "./routes/settings.js";
import notificationRoutes from "./routes/notifications.js";
import setupRoutes from "./routes/setup.js";
import partyPortalRoutes from "./routes/partyPortal.js";

dotenv.config();
const app = express();

// Fail loudly in production if the JWT secrets were left as the insecure
// development defaults — a leaked/guessable secret would let an attacker
// mint valid tokens for any user or portal session.
if (process.env.NODE_ENV === "production") {
  const insecureDefaults = [
    "dev_secret",
    "dev_refresh_secret",
    "dev_portal_secret_change_me",
    "change_this_access_secret",
    "change_this_refresh_secret",
    "change_this_party_portal_secret",
  ];
  const secretsInUse = [process.env.JWT_ACCESS_SECRET, process.env.JWT_REFRESH_SECRET, process.env.PORTAL_JWT_SECRET];
  const insecure = secretsInUse.some((s) => !s || s.length < 16 || insecureDefaults.includes(s));
  if (insecure) {
    console.error(
      "FATAL: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, and PORTAL_JWT_SECRET must all be set to unique, random values of at least 16 characters in production (e.g. `openssl rand -hex 32`). Refusing to start with insecure/default/placeholder secrets."
    );
    process.exit(1);
  }
}

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

// General API rate limit — generous for normal warehouse-floor usage patterns
// (many quick taps in a row), but stops runaway/abusive request loops.
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please slow down and try again shortly.", errors: [] },
  })
);

// Tighter limits on every public authentication surface this app has —
// admin login, the one-time setup endpoint, and the party portal's own
// login — to blunt password-guessing / brute-force attempts specifically.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again in a few minutes.", errors: [] },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/setup", authLimiter);
app.use("/api/party-portal/login", authLimiter);
app.use("/api/party-portal/verify", authLimiter);

app.get("/api/health", (req, res) => res.json({ success: true, data: { status: "ok" } }));

app.use("/api/auth", authRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/parties", partyRoutes);
app.use("/api/containers", containerRoutes);
app.use("/api/loading", loadingRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/users", userRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/setup", setupRoutes);
app.use("/api/party-portal", partyPortalRoutes);

app.use((req, res) => fail(res, "Not found.", 404));

// Centralized error handler — never leak technical errors to the client (spec #66, #134)
app.use((err, req, res, next) => {
  console.error(err);
  fail(res, "Something went wrong. Please try again.", 500);
});

export default app;
