import React, { useEffect, useState } from "react";
import { Download, Printer, FileDown } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { printSection } from "../lib/print.js";
import { Card, Button, Input, Select, SearchInput, EmptyState, ErrorState, Skeleton, formatCurrency, formatDate, PrintHeaderFooter } from "../components/ui.jsx";

const TABS = [
  { key: "storage", label: "Storage" },
  { key: "loading", label: "Loading" },
  { key: "rent", label: "Rent" },
  { key: "performance", label: "Warehouse Performance" },
];

function toCsv(rows, columns) {
  const header = columns.map((c) => `"${c.label}"`).join(",");
  const body = rows
    .map((r) => columns.map((c) => `"${String(c.value(r)).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadReportPdf(title, rows, columns, companyName) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(13);
  doc.setFont(undefined, "bold");
  doc.text(companyName || "Timber Storage Pro", 14, 14);
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.text(title, 14, 20);
  autoTable(doc, {
    startY: 25,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [124, 94, 60] },
    head: [columns.map((c) => c.label)],
    body: rows.map((r) =>
      columns.map((c) => {
        const v = c.value(r);
        return typeof v === "number" && (c.key === "rate" || c.key.includes("accrued") || c.key === "billed" || c.key === "outstanding" || c.key === "totalInvoiced")
          ? formatCurrency(v)
          : v;
      })
    ),
  });
  doc.save(`${title.replace(/\s+/g, "_")}.pdf`);
}

export default function Reports() {
  const { activeWarehouseId, companyName, developerName } = useApp();
  const [tab, setTab] = useState("storage");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [search, setSearch] = useState("");
  const [partyId, setPartyId] = useState("");
  const [status, setStatus] = useState("");
  const [parties, setParties] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.parties().then(setParties).catch(() => {});
  }, []);

  const load = async () => {
    setError("");
    setRows(null);
    try {
      const wh = activeWarehouseId !== "all" ? activeWarehouseId : undefined;
      const common = { warehouse_id: wh, search: search || undefined, party_id: partyId || undefined };
      let data;
      if (tab === "storage") data = await api.storageReport({ ...common, status: status || undefined });
      else if (tab === "loading") data = await api.loadingReport({ ...common, start: start || undefined, end: end || undefined });
      else if (tab === "rent") data = await api.rentReport({ ...common, status: status || undefined });
      else data = await api.warehousePerformance();
      setRows(data);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeWarehouseId, start, end, partyId, status]);

  useEffect(() => {
    if (tab === "performance") return; // performance tab has no per-row search
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Reset filters that don't apply to every tab when switching tabs, so a
  // "Cleared" status filter left on from Storage doesn't silently keep
  // hiding rows on a tab where it's not shown as a control.
  useEffect(() => {
    setStatus("");
  }, [tab]);

  const columnsFor = {
    storage: [
      { key: "container_number", label: "Container", value: (r) => r.container_number },
      { key: "party_name", label: "Party", value: (r) => r.party_name },
      { key: "arrival", label: "Arrival", value: (r) => formatDate(r.date_of_unloading) },
      { key: "initial", label: "Initial", value: (r) => r.initial_packets },
      { key: "loaded", label: "Loaded", value: (r) => r.loaded_packets },
      { key: "remaining", label: "Remaining", value: (r) => r.remaining },
      { key: "rent_type", label: "Rent Type", value: (r) => r.rent_type },
      { key: "rate", label: "Rate", value: (r) => r.rent_rate },
      { key: "accrued", label: "Accrued Rent", value: (r) => r.accruedRent },
      { key: "status", label: "Status", value: (r) => r.status },
    ],
    loading: [
      { key: "date", label: "Date", value: (r) => formatDate(r.date_of_loading) },
      { key: "container_number", label: "Container", value: (r) => r.container_number },
      { key: "party_name", label: "Party", value: (r) => r.party_name },
      { key: "vehicle_number", label: "Vehicle", value: (r) => r.vehicle_number },
      { key: "driver_number", label: "Driver", value: (r) => r.driver_number },
      { key: "packets_loaded", label: "Bundles", value: (r) => r.packets_loaded },
      { key: "branch_name", label: "Warehouse", value: (r) => r.branch_name },
    ],
    rent: [
      { key: "container_number", label: "Container", value: (r) => r.container_number },
      { key: "party_name", label: "Party", value: (r) => r.party_name },
      { key: "arrival", label: "Arrival", value: (r) => formatDate(r.date_of_unloading) },
      { key: "days", label: "Days", value: (r) => r.days },
      { key: "rent_type", label: "Rent Type", value: (r) => r.rent_type },
      { key: "rate", label: "Rate", value: (r) => r.rent_rate },
      { key: "accrued", label: "Accrued", value: (r) => r.accruedRent },
      { key: "billed", label: "Billed", value: (r) => r.billed },
      { key: "outstanding", label: "Outstanding", value: (r) => r.outstanding },
    ],
    performance: [
      { key: "branch_name", label: "Warehouse", value: (r) => r.branch_name },
      { key: "activeContainers", label: "Active Containers", value: (r) => r.activeContainers },
      { key: "storedBundles", label: "Stored Bundles", value: (r) => r.storedBundles },
      { key: "totalInvoiced", label: "Total Invoiced", value: (r) => r.totalInvoiced },
      { key: "outstanding", label: "Outstanding", value: (r) => r.outstanding },
    ],
  };

  const columns = columnsFor[tab];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Reports</h2>

      <div className="no-print flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-primary-600 text-white" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "performance" && (
        <div className="no-print flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={tab === "loading" ? "Search container, party, vehicle..." : "Search container or party..."}
            className="min-w-[220px] flex-1"
          />
          <Select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="!w-auto !py-2">
            <option value="">All Parties</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.party_name}
              </option>
            ))}
          </Select>
          {(tab === "storage" || tab === "rent") && (
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto !py-2">
              <option value="">All Status</option>
              <option value="Active">Active</option>
              <option value="Cleared">Cleared</option>
            </Select>
          )}
          {tab === "loading" && (
            <>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="!w-auto !py-2" />
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="!w-auto !py-2" />
            </>
          )}
          {(search || partyId || status || start || end) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setPartyId("");
                setStatus("");
                setStart("");
                setEnd("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!rows && !error && <Skeleton className="h-64" />}
      {rows && rows.length === 0 && <EmptyState title="No data for this report yet." />}

      {rows && rows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="no-print flex items-center justify-end gap-2 border-b border-stone-100 dark:border-stone-800 p-3">
            <Button size="sm" variant="outline" onClick={() => printSection("report-print-area")}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadCsv(`${tab}_report.csv`, toCsv(rows, columns))}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadReportPdf(`${TABS.find((t) => t.key === tab)?.label} Report`, rows, columns, companyName)}
            >
              <FileDown className="h-4 w-4" /> Export PDF
            </Button>
          </div>
          <div id="report-print-area">
            <PrintHeaderFooter companyName={companyName} developerName={developerName} />
            <table className="w-full text-sm">
              <thead className="bg-stone-50 dark:bg-stone-900 text-left text-xs uppercase text-stone-500">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-stone-700 dark:text-stone-300">
                        {typeof c.value(r) === "number" && (c.key === "rate" || c.key.includes("accrued") || c.key === "billed" || c.key === "outstanding" || c.key === "totalInvoiced")
                          ? formatCurrency(c.value(r))
                          : c.value(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
