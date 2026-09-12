import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Filter } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import {
  Card,
  Badge,
  Button,
  BottomSheet,
  Select,
  SearchInput,
  Table,
  EmptyState,
  ErrorState,
  Skeleton,
  formatCurrency,
  formatDate,
} from "../components/ui.jsx";

const STATUS_TONE = {
  Draft: "neutral",
  Generated: "info",
  "Partially Paid": "warning",
  Paid: "success",
  Cancelled: "danger",
};

export default function Invoices() {
  const { activeWarehouseId } = useApp();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const load = async () => {
    setError("");
    try {
      const params = { search: search || undefined, status: status || undefined };
      if (activeWarehouseId !== "all") params.warehouse_id = activeWarehouseId;
      setInvoices(await api.invoices(params));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWarehouseId, status]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const columns = [
    { key: "invoice_number", label: "Invoice #", render: (r) => <span className="font-medium text-stone-900 dark:text-stone-50">{r.invoice_number}</span> },
    { key: "party_name", label: "Party" },
    { key: "branch_name", label: "Warehouse" },
    { key: "invoice_date", label: "Date", render: (r) => formatDate(r.invoice_date) },
    { key: "subtotal", label: "Total", render: (r) => formatCurrency(r.subtotal) },
    { key: "balance", label: "Balance", render: (r) => formatCurrency(r.balance) },
    { key: "status", label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status] || "neutral"}>{r.status}</Badge> },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => navigate(`/invoices/${r.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Invoices</h2>

      <div className="flex items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoice # or party..." className="flex-1" />
        <Button variant="outline" onClick={() => setFilterOpen(true)} className="shrink-0 lg:hidden">
          <Filter className="h-4 w-4" />
        </Button>
        <div className="hidden lg:block">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!py-2">
            <option value="">All Status</option>
            <option value="Generated">Generated</option>
            <option value="Partially Paid">Partially Paid</option>
            <option value="Paid">Paid</option>
            <option value="Cancelled">Cancelled</option>
          </Select>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!invoices && !error && <Skeleton className="h-64" />}
      {invoices && invoices.length === 0 && <EmptyState title="No invoices found." description="Generate a bill from the Billing page." />}

      {invoices && invoices.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
            {invoices.map((inv) => (
              <Card key={inv.id} className="p-4" onClick={() => navigate(`/invoices/${inv.id}`)}>
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-stone-900 dark:text-stone-50">{inv.invoice_number}</p>
                  <Badge tone={STATUS_TONE[inv.status] || "neutral"}>{inv.status}</Badge>
                </div>
                <p className="mb-2 text-xs text-stone-500">{inv.party_name} · {formatDate(inv.invoice_date)}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-500">Total {formatCurrency(inv.subtotal)}</span>
                  <span className="font-semibold text-primary-600">Bal {formatCurrency(inv.balance)}</span>
                </div>
              </Card>
            ))}
          </div>
          <Table columns={columns} rows={invoices} />
        </>
      )}

      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Invoices">
        <div className="space-y-4">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="Generated">Generated</option>
            <option value="Partially Paid">Partially Paid</option>
            <option value="Paid">Paid</option>
            <option value="Cancelled">Cancelled</option>
          </Select>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStatus("")}>
              Reset
            </Button>
            <Button className="flex-1" onClick={() => setFilterOpen(false)}>
              Apply Filters
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
