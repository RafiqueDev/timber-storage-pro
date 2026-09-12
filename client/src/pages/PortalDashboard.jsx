import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, LogOut, Boxes, PackageCheck, CheckCircle2, Wallet, Clock, Receipt, ChevronDown, ChevronUp } from "lucide-react";
import { portalApi } from "../api/client.js";
import { Card, Badge, Button, StatCard, formatCurrency, formatDate, Skeleton, ErrorState } from "../components/ui.jsx";

const STATUS_TONE = { Draft: "neutral", Generated: "info", "Partially Paid": "warning", Paid: "success", Cancelled: "danger" };

function timeUntil(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

export default function PortalDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("containers");
  const [expandedInvoice, setExpandedInvoice] = useState(null);

  const token = sessionStorage.getItem("tsp_portal_token");

  const load = async () => {
    if (!token) {
      navigate("/portal/login", { replace: true });
      return;
    }
    setError("");
    try {
      setData(await portalApi.me(token));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = () => {
    sessionStorage.removeItem("tsp_portal_token");
    sessionStorage.removeItem("tsp_portal_party");
    sessionStorage.removeItem("tsp_portal_expires");
    navigate("/portal/login", { replace: true });
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
        <div className="w-full max-w-sm text-center">
          <ErrorState message={error} />
          <Button className="mt-4" onClick={() => navigate("/portal/login", { replace: true })}>
            Back to Login
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-stone-50 p-4">
        <Skeleton className="h-16" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  const symbol = data.company?.currency_symbol || "Rs.";

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white">
              <Package className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-bold text-stone-900 dark:text-stone-50">{data.party.party_name}</p>
              <p className="text-xs text-stone-400">{data.company?.name || "Timber Storage Pro"} Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1 text-xs text-stone-400 sm:flex">
              <Clock className="h-3.5 w-3.5" /> {timeUntil(data.expiresAt)} left
            </span>
            <Button size="sm" variant="outline" onClick={logout}>
              <LogOut className="h-3.5 w-3.5" /> Exit
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total Containers" value={data.totalContainers} icon={Boxes} />
          <StatCard label="Active" value={data.activeContainers} icon={PackageCheck} tone="forest" />
          <StatCard label="Cleared" value={data.clearedContainers} icon={CheckCircle2} tone="forest" />
          <StatCard label="Outstanding" value={formatCurrency(data.outstandingBalance, symbol)} icon={Wallet} tone="red" />
        </div>

        {data.availableCredit > 0 && (
          <Card className="border-forest-500/30 bg-forest-500/5 p-4">
            <p className="text-sm font-medium text-forest-700 dark:text-forest-400">
              You have {formatCurrency(data.availableCredit, symbol)} in available credit, which will automatically apply to your
              next bill.
            </p>
          </Card>
        )}

        <div className="flex gap-2">
          {[
            { key: "containers", label: "Containers" },
            { key: "invoices", label: "Invoices" },
            { key: "payments", label: "Payments" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key ? "bg-primary-600 text-white" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "containers" && (
          <div className="space-y-3">
            {data.containers.length === 0 && <p className="text-sm text-stone-400">No containers yet.</p>}
            {data.containers.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-stone-900 dark:text-stone-50">{c.container_number}</p>
                  <Badge tone={c.status === "Active" ? "success" : "neutral"}>{c.status}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="font-semibold text-stone-800 dark:text-stone-100">{c.initial_packets}</p>
                    <p className="text-stone-400">Initial</p>
                  </div>
                  <div>
                    <p className="font-semibold text-stone-800 dark:text-stone-100">{c.loaded_packets}</p>
                    <p className="text-stone-400">Loaded</p>
                  </div>
                  <div>
                    <p className="font-semibold text-primary-600">{c.remaining_packets}</p>
                    <p className="text-stone-400">Remaining</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3 text-xs text-stone-500 dark:border-stone-800">
                  <span>Arrived {formatDate(c.date_of_unloading)}</span>
                  <span>
                    {c.rent_type} — {formatCurrency(c.rent_rate, symbol)}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "invoices" && (
          <div className="space-y-3">
            {data.invoices.length === 0 && <p className="text-sm text-stone-400">No invoices yet.</p>}
            {data.invoices.map((inv) => (
              <Card key={inv.id} className="p-4">
                <button className="flex w-full items-center justify-between text-left" onClick={() => setExpandedInvoice(expandedInvoice === inv.id ? null : inv.id)}>
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-50">
                      {inv.invoice_number}
                      {inv.type === "CreditNote" && <Badge tone="danger">Credit Note</Badge>}
                    </p>
                    <p className="text-xs text-stone-400">
                      {formatDate(inv.invoice_date)} · {inv.branch_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[inv.status] || "neutral"}>{inv.status}</Badge>
                    {expandedInvoice === inv.id ? <ChevronUp className="h-4 w-4 text-stone-400" /> : <ChevronDown className="h-4 w-4 text-stone-400" />}
                  </div>
                </button>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-stone-500">Total {formatCurrency(inv.subtotal, symbol)}</span>
                  <span className="font-semibold text-primary-600">Balance {formatCurrency(inv.balance, symbol)}</span>
                </div>
                {expandedInvoice === inv.id && inv.items?.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-stone-100 pt-3 dark:border-stone-800">
                    {inv.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-xs">
                        <span className="text-stone-500">
                          {item.container_number} · {item.billable_days} days
                        </span>
                        <span className="font-medium text-stone-700 dark:text-stone-200">{formatCurrency(item.calculated_rent, symbol)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {tab === "payments" && (
          <div className="space-y-3">
            {data.payments.length === 0 && <p className="text-sm text-stone-400">No payments recorded yet.</p>}
            {data.payments.map((p) => (
              <Card key={p.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-forest-500/10">
                    <Receipt className="h-4 w-4 text-forest-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-stone-800 dark:text-stone-100">
                      {p.payment_method}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </p>
                    <p className="text-xs text-stone-400">{formatDate(p.payment_date)}</p>
                  </div>
                </div>
                <span className="font-semibold text-forest-600">{formatCurrency(p.amount, symbol)}</span>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
