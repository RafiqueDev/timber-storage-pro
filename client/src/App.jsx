import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useApp } from "./context/AppContext.jsx";
import Layout from "./components/Layout.jsx";

import Setup from "./pages/Setup.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Containers from "./pages/Containers.jsx";
import ContainerDetail from "./pages/ContainerDetail.jsx";
import LoadingHistory from "./pages/LoadingHistory.jsx";
import Parties from "./pages/Parties.jsx";
import PartyDetail from "./pages/PartyDetail.jsx";
import Billing from "./pages/Billing.jsx";
import Invoices from "./pages/Invoices.jsx";
import InvoiceDetail from "./pages/InvoiceDetail.jsx";
import Reports from "./pages/Reports.jsx";
import Warehouses from "./pages/Warehouses.jsx";
import Users from "./pages/Users.jsx";
import Settings from "./pages/Settings.jsx";
import Profile from "./pages/Profile.jsx";
import AuditLogs from "./pages/AuditLogs.jsx";
import PartyPortalManagement from "./pages/PartyPortalManagement.jsx";
import PortalLogin from "./pages/PortalLogin.jsx";
import PortalAccess from "./pages/PortalAccess.jsx";
import PortalDashboard from "./pages/PortalDashboard.jsx";

function ProtectedRoute({ children }) {
  const { user, authLoading } = useApp();
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user } = useApp();

  return (
    <Routes>
      {/* Multi-tenant: Setup is a normal, always-reachable public page —
          anyone can create a brand new, fully isolated company + admin
          account here at any time, the same way Login is always reachable.
          It is never gated behind "has anyone signed up yet". */}
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

      {/* Party Portal: a completely separate, party-facing auth path — never
          wrapped in ProtectedRoute, which checks the ADMIN user's session. */}
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal/dashboard" element={<PortalDashboard />} />
      <Route path="/portal/:token" element={<PortalAccess />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/containers" element={<Containers />} />
        <Route path="/containers/:id" element={<ContainerDetail />} />
        <Route path="/loading" element={<LoadingHistory />} />
        <Route path="/parties" element={<Parties />} />
        <Route path="/parties/:id" element={<PartyDetail />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/warehouses" element={<Warehouses />} />
        <Route path="/users" element={<Users />} />
        <Route path="/party-portal-management" element={<PartyPortalManagement />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/audit-logs" element={<AuditLogs />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
