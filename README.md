# Timber Storage Pro

A full-stack, mobile-first, multi-branch **Timber Warehouse & Storage Management System**.

Tracks containers, stock (initial/loaded/remaining bundles), storage rent (daily or monthly,
with an editable billable-days override), A5-landscape PDF invoices, partial payments, party
statements, multi-branch/role-based access control, and a full audit trail.

---

## 1. Latest round: banked credit, party portal, undo everywhere, and a security hardening pass

- **Issue Adjustment now banks the credit for the party's NEXT bill, instead of netting immediately.**
  Previously an adjustment created a credit note that reduced the party's current outstanding
  balance right away. Now it's banked (`credit_remaining`) and sits untouched until the party is
  billed again — at which point it's automatically applied, oldest-credit-first, exactly like a
  payment (so invoice status/balance logic stays unified). This matches the real workflow: pay off
  an invoice in full, issue an adjustment for a dispute/goodwill amount, and it quietly reduces
  their *next* bill instead of reopening the one that was already settled.
- **Party Portal** — a completely new feature. From **Party Portal Management** in the sidebar, an
  admin or branch manager generates a secure, auto-generated username/password plus a one-click
  magic link for any party, valid for exactly 24 hours. "Copy Message" copies a ready-to-send
  summary; "Send via WhatsApp" opens WhatsApp with it pre-filled (via a standard `wa.me` link — no
  WhatsApp Business API integration needed). The party opens the link (or logs in manually at
  `/portal/login`) and sees a read-only portal with their full history: every container
  (active/cleared, with remaining bundles), every invoice (with line-item detail), every payment,
  and any available banked credit — no staff login required, and it's on a completely separate
  authentication path from the admin app (different secret, different token, cannot be used
  against admin routes, revoking access cuts it off immediately even mid-session).
- **Undo, for anything that hasn't had real-world consequences yet** — Containers, loading
  records, invoices, adjustments, payments, and parties can now be permanently removed, but only
  while undoing them is genuinely safe: a container with no loading or billing history, a loading
  entry (recalculates the container from what's left), an invoice with no payments and no
  adjustment issued against it, a credit note that hasn't been applied to anything yet, a payment
  (refunding banked credit back to its source if it was an auto-applied one), or a party with no
  containers. Anything with real money or history already attached routes to the existing
  Cancel / Issue Adjustment flows instead, which keep an audit trail rather than erasing it.
- **Security audit pass** — found and fixed several real authorization gaps: `GET` on a single
  invoice, the eligible-containers list, invoice cancel/adjust, and the payments list were not
  checking that a Branch Manager/Staff user's requested (or implicit) warehouse was one they're
  actually assigned to, meaning a non-admin could potentially view or act on data outside their
  assigned branch by ID or by omitting a filter. All now enforce the same warehouse-scoping used
  elsewhere. Also added: rate limiting on every public auth surface (admin login, setup, and the
  new party portal login/magic-link), a request body size limit, a stricter default CORS origin
  instead of a wildcard, and a startup check that refuses to boot in `NODE_ENV=production` if any
  JWT secret is left as a default/placeholder value or under 16 characters.
- **On the database question** — see section 6 for a full, honest comparison of the current SQLite
  setup against migrating to MongoDB, and why that wasn't done as part of this round.

## 2. Previous round: mobile polish, editable loading history, and clearer billing status

- **Invoice Detail page redesigned for mobile** — the action row used to wrap into a crowded,
  overlapping stack of buttons on narrow screens. On mobile it's now a compact top bar (Back +
  a "More" button opening a bottom sheet with Edit/Print/PDF/Share/Adjust/Cancel) plus a
  prominent full-width "Record Payment" button when money is owed. Desktop is unchanged.
- **Loading records are now editable** — every entry in Loading History (and on a container's own
  detail page) has an Edit action to correct the quantity, date, vehicle, driver, or description.
  The container's loaded/remaining totals are recalculated from its *entire* loading history after
  every edit (not patched by a delta), so numbers can't drift even after repeated corrections —
  and if an edit un-clears a container that was previously fully loaded out, it correctly reopens
  as Active again.
- **Clearer billing status on the Generate Bill screen** — each eligible container now shows
  up to four plain-language badges: **Cleared** (fully unloaded), **bundles remaining**,
  **Already Billed** (red — an invoice exists and nothing new has accrued to bill), and
  **Billed & Payment Cleared** (green — that invoice has since been fully paid). A container in
  either "already billed" state can't be re-selected for billing (still fully viewable from its
  own page or Invoices) until new days actually accrue — at which point it becomes billable again
  automatically.
- **Login (and Setup) screens redesigned** — replaced the pale, washed-out light background with
  a deliberately rich, dark, glowing aesthetic that no longer depends on the visitor's light/dark
  preference (they haven't logged in yet, so there isn't one to read).

## 3. Previous addition: create your account in the browser — no terminal wizard needed

- **A one-time Setup screen** now appears automatically the first time you open the app on a
  fresh install (before any account exists). It's a 2-step form — your company name + currency,
  then your admin name, username, email (optional), and password — and logs you straight in when
  done. No demo data is created, just your company and your one Super Admin account.
- This is the **only** public "sign-up" this app ever allows, and only while the system is
  genuinely empty: the moment an account exists, both the Setup screen and its API endpoint
  (`POST /api/setup`) are permanently locked out (`403 This system has already been set up`),
  even if someone finds the URL directly. There's still no way to self-register a *second* account
  — new users are always created by a Super Admin from Admin > Users.
- The old CLI wizard (`npm run init`, described below) still works too, if you'd rather set things
  up before ever opening a browser, or need to script it.

## 4. Previous addition: `npm run init` (CLI alternative to the Setup screen)

- An interactive terminal wizard (`server/src/init.js`) that asks the same questions as the
  Setup screen — company name, currency, admin name/username/password — for anyone who'd rather
  set things up before opening a browser, or wants to script it. Also doubles as a way to reset
  the system back to empty later (it always wipes existing data first, with a confirmation
  prompt). See "Getting started" below for both options side by side.

## 5. Bug-fix round

Fixes for issues found in real usage:

- **Reports are now filterable and searchable** — Storage, Loading, and Rent reports each have a search box (container/party/vehicle), a Party filter, and a Status filter (Active/Cleared) where relevant, in addition to the existing warehouse scope and date range.
- **Fixed: "Assign Warehouses" showing empty when editing a user** — the Users page was trusting a warehouse list cached in context from login time, which could go stale. It now refetches the live warehouse list every time the page opens, and shows a clear "no warehouses yet" message instead of a blank picker if none exist.
- **Fixed: new/cleared containers couldn't be billed** — `fullyBilled` was computed as `defaultDays <= 0`, which is *also* true for a brand-new container created today (0 days accrued yet), so its checkbox was wrongly disabled on the Billing screen. Now `fullyBilled` only applies to a genuinely exhausted Cleared container, and the checkbox is never disabled — every eligible container (active or cleared) stays selectable with a manually-editable day count.
- **Invoice editing** — a new "Edit Invoice" action lets you correct billable days per line item on an unpaid invoice (recalculated through the same central billing engine used at generation time). Once any payment has been recorded against an invoice it locks and routes to the existing "Issue Adjustment" credit-note flow instead, so a payment can never be left referencing an amount that no longer exists.
- **Low-stock alerts removed** — the "Low stock" badge/warning on containers and the corresponding notification have been removed by request.
- **Parties redesigned as horizontal rows** — each party now shows Total/Active/Cleared container counts side by side, backed by a single aggregate query (avoids an N+1 query per party). A warehouse filter and status filter were added to the Parties page too.

## 6. Recent additions (prior revision)

On top of the original build, an earlier revision added:

- **Container history & fully-loaded tracking** — every container now records `last_loading_date` (the exact date of its most recent loading activity) and `cleared_at`, so a fully-unloaded container's finish date is precisely known, independent of "today."
- **Cleared containers stay billable** — the billing screen previously only showed `status = Active` containers, so a container that hit zero remaining stock would vanish before its final period was billed. It now includes `Cleared` containers too, with accrued rent correctly frozen at the last loading date instead of continuing to grow.
- **Flexible billing period / manual override** — the central billing engine (`server/src/services/billing.js`) now exposes `breakdownDuration()` (e.g. 64 days → "2 months, 4 days") and `daysForBillingMode()` (exact / round-down-to-months / round-up-to-next-month). The Billing screen surfaces this as a per-container mode picker; the resulting day count is always still manually editable afterward.
- **Invoice adjustments** — an "Issue Adjustment" action on any invoice creates a linked, audited credit note rather than silently rewriting the original invoice's stored numbers (preserving the immutability rule from the spec).
- **Notifications** — invoice generated, payment received, and container cleared events now notify the relevant Super Admins + warehouse-assigned users; a bell icon in the header shows unread count and a mark-as-read panel.
- **Rate limiting** — general API and a stricter login-specific limiter.
- **Clean, scoped printing** — Container Detail, Invoice Detail, Party Statement, and Reports now have a "Print" button that prints *only* that record (via `client/src/lib/print.js`), with a minimal company-name header and developer-name footer (configurable in Settings), instead of the whole app chrome.
- **Breadcrumbs** — the desktop header shows a live "Dashboard / Containers / CONT-001" trail.
- **Web Share API** — invoice PDFs can be shared directly via the OS share sheet on supporting devices, falling back to download.
- **PDF report export** — Reports now export to PDF in addition to CSV/print.
- **Slightly denser, more modern visual pass** — smaller base font size, gradient primary buttons, subtle card hover lift, and a soft gradient/grid backdrop on the login screen.

## 7. Features included

- **Auth**: JWT access + refresh tokens, bcrypt password hashing, 3 roles (Super Admin, Branch
  Manager, Staff) with server-side warehouse isolation enforced on *every* warehouse-scoped
  route (not just the UI).
- **Warehouses**: multi-branch, global warehouse selector ("All Warehouses" for admins),
  soft-deactivation (no hard deletes on financial data).
- **Parties (customers)**: CRUD, dashboard stats, statement of invoices/payments.
- **Containers**: full CRUD, unique per-warehouse container numbers, initial/loaded/remaining
  bundle tracking, low-stock flag, auto-clear at 0 remaining, manual clear.
- **Loading (outbound) log**: atomic, concurrency-safe stock decrement (a DB-level conditional
  UPDATE prevents two simultaneous loads from over-drawing stock), full validation (no
  over-loading, no negative/zero quantities, loading date can't precede unloading date).
- **Central billing engine** (`server/src/services/billing.js`): the *only* place rent is ever
  calculated — Dashboard, invoice generation, reports and the PDF all call the same function so
  numbers can never drift apart. Daily = `days × rate`. Monthly = `(rate / 30) × days`,
  decimal-safe rounding.
- **Billing workflow**: pick a party → see eligible active containers with a default billable-days
  suggestion (today − last-billed-date or unload date) → override per-container → live total →
  generate. The **backend re-validates and re-calculates everything server-side** — it never
  trusts the client's numbers.
- **Invoices**: sequential invoice numbers (`INV-2026-000001`), line-item snapshots (so historical
  invoices never change even if a container's rate changes later), partial payments, status
  (Generated/Partially Paid/Paid/Cancelled), A5 landscape PDF with signature lines, cancel-if-unpaid.
- **Payments**: partial payment support, balance/status kept in sync, can't overpay.
- **Reports**: Storage, Loading, Rent, Warehouse Performance — with CSV export and print.
- **Users & roles**: create/edit users, assign to warehouses, reset password, deactivate.
- **Audit log**: every mutation (login, container/loading/invoice/payment/warehouse/user changes)
  is recorded with actor, action, entity and timestamp.
- **Settings**: company name, currency, invoice prefix, date format, timezone, low-stock threshold.
- **Mobile-first responsive UI**: bottom tab bar + "More" bottom sheet on mobile, persistent
  collapsible sidebar on desktop, tables become cards on mobile, bottom sheets for filters and the
  warehouse switcher, dark mode, toasts, confirmation dialogs, empty/loading/error states
  throughout, 48px touch targets.

## 8. What's intentionally lighter-weight than a full production build

Being upfront, since the original spec (148 sections) describes weeks of a team's work:

- **PWA/offline/service-worker support** isn't implemented — the spec asked to *architect for*
  this, not necessarily deliver it, and the app is structured so it could be added (clean API
  layer, no direct DOM/localStorage coupling in business logic).
- **SQLite instead of MongoDB** — chosen so this project runs with zero external services (no
  Docker, no cloud database signup) with `npm install && npm run seed && npm run dev`. The data
  access is isolated behind `db.js` / route files, so swapping to MongoDB/Mongoose later is a
  contained change, not a rewrite.
- **Notification preferences** are not yet a per-user configurable UI — everyone assigned to a
  warehouse (plus all Super Admins) gets notified of that warehouse's events; there's no opt-out
  screen yet.
- **CSS/inline styling covers the full spec's dark-mode requirement** for all screens built, but
  wasn't independently pixel-audited on every breakpoint listed (320–1440px+) the way a QA pass
  with real devices would.

Everything else in the spec — the data model, validation rules, billing formulas, security
boundaries, and screen list — is implemented and was tested end-to-end (see section 10).

## 9. Tech stack

**Backend**: Node.js, Express, SQLite (`better-sqlite3`), JWT, bcrypt, express-rate-limit, manual validation.
**Frontend**: React 18, Vite, Tailwind CSS, React Router, Axios, jsPDF + jspdf-autotable, lucide-react.

## 10. Getting started

Requires Node.js 18+.

```bash
# 1. Backend
cd server
cp .env.example .env
npm install
npm run dev         # http://localhost:4000

# 2. Frontend (in a second terminal)
cd client
npm install
npm run dev         # http://localhost:5173 (proxies /api to :4000)
```

Open **http://localhost:5173** — on a brand-new install with no accounts yet, you'll land
straight on the **Setup screen** automatically. Fill in your company name and your admin
name/username/password, and you're logged in and ready to go. No demo data is created.

If you'd rather set things up before opening a browser (or want to script it), you can run the
equivalent CLI wizard instead of using the Setup screen:

```bash
cd server
npm run init         # interactive terminal wizard — same questions as the Setup screen
```

Either way you end up with **exactly one Super Admin account and nothing else** — no sample
warehouses, parties, containers, or invoices. From there:

1. **Admin > Warehouses** — add your first real branch (required before anything else, since
   every container/party/invoice is scoped to a warehouse).
2. **Admin > Users** — create logins for any other managers/staff and assign them to warehouses.
3. **Parties** — add your first real customer.
4. **Containers** — log your first real container against that party and warehouse.

`npm run init` always wipes existing data first (it asks you to type `YES` to confirm), so it's
also how you reset the system back to empty later if needed — the browser Setup screen, by
contrast, is permanently locked out (`403`) the instant an account exists, precisely so it can
never accidentally be used to reset a live system.

### Trying it out with sample data instead

Prefer to explore the app before entering real data? Skip Setup and run the demo seed instead:

```bash
cd server
npm run seed
```

Then log in with one of these demo accounts:

| Username  | Password    | Role           | Access                    |
|-----------|-------------|----------------|----------------------------|
| `admin`   | `admin123`  | Super Admin    | All warehouses             |
| `manager` | `manager123`| Branch Manager | Main Terminal Yard only    |
| `staff`   | `staff123`  | Staff          | Main Terminal Yard only    |

Re-run `npm run seed` at any time from `server/` to reset the database back to this demo state
(this also wipes whatever was there before, including real data — so don't run it once you're
using the app for real; use `npm run init` if you ever need to reset a real system instead).

### Running the automated tests

```bash
cd server
npm test    # runs 37 tests via node --test — no separate test DB setup needed
```

### Production build

```bash
cd client && npm run build   # outputs client/dist — serve with any static host / nginx
cd server && npm start       # or run behind pm2 / systemd; put it behind HTTPS in production
```

Remember to change `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `PORTAL_JWT_SECRET` in `server/.env`
before deploying — the server now refuses to start in `NODE_ENV=production` if any of them are
left as a default or placeholder value, or under 16 characters.

## 11. SQLite vs. MongoDB

You asked which database this saves to, and suggested MongoDB. Direct answer: it currently uses
**SQLite** via `better-sqlite3` — a single embedded file (`server/timber.db`), not a separate
server process. Here's the honest trade-off rather than a rushed migration:

**Why SQLite was chosen for this project:**
- Zero setup — `npm install && npm run dev` and you have a working database. No Docker, no
  connection string, no separate service to install, configure, or keep running.
- The data model is genuinely relational: containers belong to warehouses and parties; invoices
  have line items that reference containers; payments and credit applications reference invoices;
  everything is tied together with foreign keys and enforced with real multi-table transactions
  (e.g. generating an invoice, applying banked credit, and inserting line items all happen
  atomically in one transaction — if any step fails, all of it rolls back). SQL and ACID
  transactions are a natural fit for that; a lot of this logic would need to be rebuilt by hand in
  an application layer with a document database.
- It's genuinely fast enough for this workload (a single warehouse operation's data volume) and
  the whole database is one file you can back up by copying it.

**What MongoDB would trade in return:**
- *Pro:* easier horizontal scaling and multi-server deployment; a more familiar fit if your team
  is already JS/Node-and-Mongo-first; flexible schema if the data shape were expected to change
  unpredictably (it isn't here — the schema is stable and well-understood).
- *Con:* every JOIN in this codebase (and there are many — containers→parties→warehouses,
  invoices→items→payments→credit applications, reports that aggregate across several of these at
  once) would need to become either an application-level fetch-and-merge, denormalized/duplicated
  data kept in sync by hand, or MongoDB's aggregation pipeline (its own learning curve, and slower
  to iterate on than SQL for this kind of relational reporting). The atomic multi-table
  transactions described above would need Mongo's multi-document transaction API, which carries
  its own performance and operational considerations. And it adds a real external dependency
  (a MongoDB server, Atlas account, or similar) where today there is none.

**Bottom line:** this isn't a "SQLite is always right" position — for a project with much higher
write concurrency across many servers, or a genuinely unpredictable/document-shaped schema,
MongoDB would be the better call. For this app's actual shape (relational, transactional,
single-deployment), SQLite is doing the right job. If you do want to move to MongoDB, I'd treat it
as its own dedicated migration project — rewriting every route's queries, redesigning the schema
around denormalization, and re-testing every one of the 46 automated tests against the new data
layer — rather than something to bolt on inside a round of feature work, since a rushed database
swap is exactly how a stable app gets bugs and lag introduced, which runs counter to the "check for
bugs and lag" ask in this same round.

## 12. What was verified before delivery

- `npx vite build` — the entire frontend compiles cleanly with no errors, including on a
  completely fresh `npm install` (no cached `node_modules`).
- `npm test` in `server/` — **46 automated tests** (`node --test`) pass, covering everything from
  prior rounds (critical stock-validation test case, exact billing formulas, warehouse isolation,
  cleared-container billing with frozen accrual dates, payment limits, the Setup flow in its own
  isolated database, loading-record edit recalculation, and the four billing-status badges) plus
  this round's additions:
  - **banked credit**: issuing an adjustment does NOT touch the original invoice's balance or the
    party's current outstanding total; it shows up as `credit_remaining` and `availableCredit`
    instead; generating a *later* invoice for the same party automatically consumes that credit
    (oldest-first) as an auto-recorded "Credit Note" payment, correctly flipping the new invoice's
    status to Partially Paid or Paid; the consumed credit note's `credit_remaining` drops to zero;
  - **undo/delete**: an unpaid invoice can be deleted, a paid one is refused with `400`; a
    container with no history can be deleted, one with loading recorded is refused; deleting a
    loading record recomputes the container's totals from what's left; deleting an auto-applied
    credit payment refunds the amount back to its originating credit note;
  - **the party portal end to end**: generating access returns working credentials and a magic
    link with an expiry within a few minutes of 24 hours; the generated username/password log in
    successfully; the magic link auto-authenticates without a password; the resulting portal token
    can fetch that party's full history (containers, invoices with line items, payments) but is
    correctly rejected (`401`) against a real admin route; revoking access immediately invalidates
    an already-issued, still-unexpired token; generating new access for the same party invalidates
    the previous username; and the management list correctly reports `active` / `revoked` / `none`
    status per party;
  - **the authorization fixes**: a Staff user is correctly refused (`403`) when requesting a
    report, the dashboard, or the payments list for a warehouse they aren't assigned to, and an
    unfiltered payments request never silently falls back to showing every warehouse's data.
- A separate live, manual end-to-end run against a freshly booted, freshly seeded server
  additionally exercised the party portal fully through real HTTP calls (generate → login → fetch
  full history → confirm cross-API rejection → magic link), confirmed undo works for a real
  container and a real party, and confirmed the production JWT-secret startup check actually
  refuses to boot with placeholder secrets (`NODE_ENV=production`, exit code 1) while booting
  normally with either real random secrets or no `NODE_ENV` set at all.

## 13. Project structure

```
timber-storage-pro/
  server/
    src/
      db.js                    # schema (source of truth) + lightweight migrations
      app.js                   # Express app (importable, used by both index.js and tests)
      index.js                 # app entrypoint (binds the port; production secret check lives in app.js)
      seed.js                  # demo data
      init.js                  # CLI wizard: your company + one admin, no demo data
      services/
        billing.js             # THE central rent calculation engine
        audit.js                # central audit logger
        notifications.js        # central notification dispatcher
      middleware/
        auth.js                  # authenticate / authorizeRole / authorizeWarehouse (admin app)
        portalAuth.js             # completely separate authenticatePortal (party portal)
      routes/                   # one file per resource, REST endpoints
        setup.js                 # public, self-guarding first-time setup endpoint
        partyPortal.js            # admin management (generate/revoke/list) + portal-facing login/me
    tests/
      billing.test.js           # unit tests for the billing engine
      api.test.js                # integration tests against a live instance of the API
      setup.test.js               # setup-flow tests, in their own isolated test database
  client/
    src/
      api/client.js             # admin API wrapper + a separate portalApi client for the portal
      context/AppContext.jsx    # auth, active warehouse, theme, toasts, notifications, company
      components/                # Layout (nav/header/sidebar/breadcrumbs), NotificationsBell,
                                  # EditLoadingModal, ui.jsx (design system)
      pages/                     # one file per screen
        Setup.jsx                 # first-time browser setup screen
        PartyPortalManagement.jsx  # admin: generate/revoke party portal access
        PortalLogin.jsx / PortalAccess.jsx / PortalDashboard.jsx  # the party-facing portal itself
      lib/
        pdf.js                   # jsPDF invoice + statement generation
        print.js                  # scoped single-record printing utility
```
