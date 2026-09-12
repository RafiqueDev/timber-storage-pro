import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Receipt, Download, Printer } from "lucide-react";
import { api } from "../api/client.js";
import { useApp } from "../context/AppContext.jsx";
import { downloadStatementPdf } from "../lib/pdf.js";
import { printSection } from "../lib/print.js";
import { Card, Button, Input, Select, formatCurrency, formatDate, ErrorState, Skeleton, PrintHeaderFooter } from "../components/ui.jsx";

export default function PartyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { warehouses, setBreadcrumbExtra, companyName, developerName } = useApp();
  const [party, setParty] = useState(null);
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const load = async () => {
    setError("");
    try {
      const [p, s] = await Promise.all([
        api.party(id),
        api.partyStatement(id, { warehouse_id: warehouseFilter || undefined, start: start || undefined, end: end || undefined }),
      ]);
      setParty(p);
      setBreadcrumbExtra(p.party_name);
      setStatement(s);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    return () => setBreadcrumbExtra(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, warehouseFilter, start, end]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!party) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-700">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <Button onClick={() => navigate(`/billing?party=${party.id}`)}>
          <Receipt className="h-4 w-4" /> Generate Bill
        </Button>
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">{party.party_name}</h2>
          <p className="text-sm text-stone-500">
            {party.contact_person} · {party.phone}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-stone-100 dark:border-stone-800 pt-4 sm:grid-cols-4">
          <Info label="Total Containers" value={party.totalContainers} />
          <Info label="Active Containers" value={party.activeContainers} />
          <Info label="Cleared Containers" value={party.clearedContainers} />
          <Info label="Stored Bundles" value={party.totalStoredBundles} />
          <Info label="Loaded Bundles" value={party.totalLoadedBundles} />
          <Info label="Accrued Rent" value={formatCurrency(party.accruedRent)} />
          <Info label="Outstanding Balance" value={formatCurrency(party.outstandingBalance)} highlight />
          {party.availableCredit > 0 && <Info label="Available Credit" value={formatCurrency(party.availableCredit)} highlight />}
        </div>
      </Card>

      <Card className="p-5">
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Party Statement</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className="!py-2 !text-xs">
              <option value="">All Warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.branch_name}
                </option>
              ))}
            </Select>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="!py-2 !text-xs" />
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="!py-2 !text-xs" />
            <Button variant="outline" size="sm" onClick={() => printSection("statement-print-area")}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadStatementPdf(party, statement.entries, statement.outstanding)}>
              <Download className="h-4 w-4" /> PDF
            </Button>
          </div>
        </div>

        <div id="statement-print-area">
          <PrintHeaderFooter companyName={companyName} developerName={developerName} />
          <p className="mb-3 hidden text-sm font-semibold print:block">Statement — {party.party_name}</p>

          {statement && statement.entries.length === 0 && <p className="text-sm text-stone-400">No invoices or payments in this range.</p>}

          {statement && statement.entries.length > 0 && (
            <div className="divide-y divide-stone-100 dark:divide-stone-800">
              {statement.entries.map((e) => (
                <div key={`${e.type}-${e.id}`} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-stone-800 dark:text-stone-100">
                      {e.type === "invoice" ? "Invoice" : "Payment"} — {e.ref}
                    </p>
                    <p className="text-xs text-stone-400">{formatDate(e.date)}</p>
                  </div>
                  <span className={`font-semibold ${e.amount < 0 ? "text-forest-600" : "text-stone-800 dark:text-stone-100"}`}>
                    {e.amount < 0 ? "-" : ""}
                    {formatCurrency(Math.abs(e.amount))}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3 text-sm font-bold">
                <span>Outstanding</span>
                <span className="text-primary-600">{formatCurrency(statement.outstanding)}</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="no-print p-5">
        <h3 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-200">Recent Invoices</h3>
        {party.recentInvoices.length === 0 && <p className="text-sm text-stone-400">No invoices yet.</p>}
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {party.recentInvoices.map((inv) => (
            <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center justify-between py-2.5 text-sm">
              <span className="font-medium text-stone-800 dark:text-stone-100">{inv.invoice_number}</span>
              <span className="text-stone-500">{formatCurrency(inv.subtotal)}</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Info({ label, value, highlight }) {
  return (
    <div>
      <p className="text-xs text-stone-400">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? "text-primary-600" : "text-stone-800 dark:text-stone-100"}`}>{value}</p>
    </div>
  );
}
