import React, { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  Truck,
  Receipt,
  MoreHorizontal,
  Users2,
  FileBarChart,
  Warehouse,
  UserCog,
  Settings as SettingsIcon,
  ScrollText,
  User,
  LogOut,
  ChevronDown,
  ChevronRight,
  Sun,
  Moon,
  Package,
  Link as LinkIcon,
} from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { BottomSheet, ToastStack } from "./ui.jsx";
import { NotificationsBell } from "./NotificationsBell.jsx";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/containers", label: "Containers", icon: Boxes, group: "Warehouse" },
  { to: "/loading", label: "Loading History", icon: Truck, group: "Warehouse" },
  { to: "/parties", label: "Parties", icon: Users2 },
  { to: "/invoices", label: "Invoices", icon: Receipt, group: "Billing" },
  { to: "/billing", label: "Generate Bill", icon: Receipt, group: "Billing" },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse, group: "Administration", adminOnly: true },
  { to: "/users", label: "Users", icon: UserCog, group: "Administration", adminOnly: true },
  { to: "/party-portal-management", label: "Party Portal", icon: LinkIcon, group: "Administration", managerOnly: true },
  { to: "/audit-logs", label: "Audit Logs", icon: ScrollText, group: "Administration" },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const MOBILE_TABS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/containers", label: "Containers", icon: Boxes },
  { to: "/loading", label: "Loading", icon: Truck },
  { to: "/billing", label: "Billing", icon: Receipt },
];

const MORE_ITEMS = [
  { to: "/parties", label: "Parties", icon: Users2 },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/warehouses", label: "Warehouses", icon: Warehouse, adminOnly: true },
  { to: "/users", label: "Users", icon: UserCog, adminOnly: true },
  { to: "/party-portal-management", label: "Party Portal", icon: LinkIcon, managerOnly: true },
  { to: "/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/profile", label: "Profile", icon: User },
];

function pageTitle(pathname) {
  const match = [...NAV, ...MORE_ITEMS].find((n) => pathname.startsWith(n.to));
  return match?.label || "Timber Storage Pro";
}

/** Builds "Dashboard / Containers / CONT-001" style trail. `extra` is an
 * optional dynamic leaf name (e.g. a container number) set by detail pages
 * via `setBreadcrumbExtra` since the route alone doesn't carry that label. */
function buildBreadcrumbs(pathname, extra) {
  const top = { to: "/dashboard", label: "Dashboard" };
  if (pathname === "/dashboard") return [top];
  const match = [...NAV, ...MORE_ITEMS].find((n) => pathname.startsWith(n.to) && n.to !== "/dashboard");
  const crumbs = [top];
  if (match) crumbs.push({ to: match.to, label: match.label });
  const isDetail = match && pathname !== match.to;
  if (isDetail && extra) crumbs.push({ to: pathname, label: extra });
  return crumbs;
}

export default function Layout() {
  const {
    user,
    warehouses,
    activeWarehouseId,
    setActiveWarehouseId,
    activeWarehouse,
    isAdmin,
    logout,
    theme,
    setTheme,
    toasts,
    pushToast,
    breadcrumbExtra,
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [whSheetOpen, setWhSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleLogout = async () => {
    await logout();
    pushToast("Logged out.");
    navigate("/login");
  };

  const isManagerOrAdmin = isAdmin || user?.role === "BRANCH_MANAGER";
  const navVisible = (n) => (!n.adminOnly || isAdmin) && (!n.managerOnly || isManagerOrAdmin);

  const grouped = NAV.filter(navVisible).reduce((acc, item) => {
    const key = item.group || "_top";
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  const warehouseLabel = activeWarehouseId === "all" ? "All Warehouses" : activeWarehouse?.branch_name || "Select warehouse";
  const crumbs = buildBreadcrumbs(location.pathname, breadcrumbExtra);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      {/* DESKTOP SIDEBAR */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 transition-all lg:flex ${
          sidebarCollapsed ? "w-[76px]" : "w-64"
        }`}
      >
        <div className="flex h-16 items-center gap-2 px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-600/20">
            <Package className="h-5 w-5" />
          </div>
          {!sidebarCollapsed && <span className="truncate font-bold tracking-tight text-stone-900 dark:text-stone-50">Timber Storage Pro</span>}
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              {group !== "_top" && !sidebarCollapsed && (
                <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-stone-400">{group}</p>
              )}
              <div className="space-y-1">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-primary-600 text-white"
                          : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                      }`
                    }
                  >
                    <item.icon className="h-4.5 w-4.5 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          className="m-3 rounded-xl border border-stone-200 dark:border-stone-800 py-2 text-xs text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800"
        >
          {sidebarCollapsed ? "»" : "« Collapse"}
        </button>
      </aside>

      <div className={`transition-all ${sidebarCollapsed ? "lg:pl-[76px]" : "lg:pl-64"}`}>
        {/* DESKTOP HEADER */}
        <header className="no-print sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-stone-200 dark:border-stone-800 bg-white/90 dark:bg-stone-900/90 backdrop-blur px-6 lg:flex">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
            {crumbs.map((c, i) => (
              <React.Fragment key={c.to + i}>
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-stone-300 dark:text-stone-600" />}
                {i === crumbs.length - 1 ? (
                  <span className="font-semibold text-stone-900 dark:text-stone-50">{c.label}</span>
                ) : (
                  <button onClick={() => navigate(c.to)} className="text-stone-500 hover:text-primary-600 dark:text-stone-400">
                    {c.label}
                  </button>
                )}
              </React.Fragment>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setWhSheetOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 px-3 py-2 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800"
            >
              <Warehouse className="h-4 w-4" />
              {warehouseLabel}
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-xl p-2.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              aria-label="Toggle dark mode"
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <NotificationsBell variant="desktop" />
            <div className="flex items-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 py-1.5 pl-1.5 pr-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-semibold text-white">
                {user?.name?.[0]}
              </div>
              <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{user?.name}</span>
            </div>
            <button onClick={handleLogout} className="rounded-xl p-2.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="Log out">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* MOBILE HEADER */}
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between border-b border-stone-200 dark:border-stone-800 bg-white/95 dark:bg-stone-900/95 backdrop-blur px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-white">
              <Package className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">{pageTitle(location.pathname)}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="touch-target rounded-full p-2 text-stone-500">
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <NotificationsBell variant="mobile" />
            <NavLink to="/profile" className="touch-target flex items-center justify-center rounded-full p-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-xs font-semibold text-white">
                {user?.name?.[0]}
              </div>
            </NavLink>
          </div>
        </header>

        {/* MOBILE WAREHOUSE PILL */}
        <div className="no-print border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 py-2 lg:hidden">
          <button
            onClick={() => setWhSheetOpen(true)}
            className="flex w-full items-center justify-between rounded-xl bg-stone-100 dark:bg-stone-800 px-3 py-2 text-sm font-medium text-stone-700 dark:text-stone-200"
          >
            <span className="flex items-center gap-2">
              <Warehouse className="h-4 w-4" /> {warehouseLabel}
            </span>
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        <main className="mx-auto max-w-7xl px-4 py-5 pb-24 lg:px-6 lg:py-6 lg:pb-6 print:p-0 print:pb-0">
          <Outlet />
        </main>
      </div>

      {/* MOBILE BOTTOM NAV */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 lg:hidden">
        {MOBILE_TABS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium touch-target ${
                isActive ? "text-primary-600" : "text-stone-400"
              }`
            }
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-stone-400 touch-target"
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      {/* MORE BOTTOM SHEET */}
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="grid grid-cols-3 gap-3">
          {MORE_ITEMS.filter(navVisible).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-stone-200 dark:border-stone-800 py-4 text-center text-xs font-medium text-stone-600 dark:text-stone-300"
            >
              <item.icon className="h-5 w-5 text-primary-600" />
              {item.label}
            </NavLink>
          ))}
          <button
            onClick={handleLogout}
            className="flex flex-col items-center gap-2 rounded-2xl border border-red-200 dark:border-red-900 py-4 text-center text-xs font-medium text-red-600"
          >
            <LogOut className="h-5 w-5" />
            Logout
          </button>
        </div>
      </BottomSheet>

      {/* WAREHOUSE SELECTOR SHEET */}
      <BottomSheet open={whSheetOpen} onClose={() => setWhSheetOpen(false)} title="Select warehouse">
        <div className="space-y-2">
          {isAdmin && (
            <button
              onClick={() => {
                setActiveWarehouseId("all");
                setWhSheetOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium ${
                activeWarehouseId === "all"
                  ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                  : "border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200"
              }`}
            >
              All Warehouses
            </button>
          )}
          {warehouses.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                setActiveWarehouseId(w.id);
                setWhSheetOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium ${
                activeWarehouseId === w.id
                  ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                  : "border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200"
              }`}
            >
              <span>{w.branch_name}</span>
              <span className="text-xs text-stone-400">{w.status}</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      <ToastStack toasts={toasts} />
    </div>
  );
}
