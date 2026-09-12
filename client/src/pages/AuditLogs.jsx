import React, { useEffect, useState } from "react";
import { Filter } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { Card, Button, BottomSheet, Input, SearchInput, EmptyState, ErrorState, Skeleton } from "../components/ui.jsx";

export default function AuditLogs() {
  const { activeWarehouseId } = useApp();
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const load = async () => {
    setError("");
    try {
      const params = { action: action || undefined, start: start || undefined, end: end || undefined };
      if (activeWarehouseId !== "all") params.warehouse_id = activeWarehouseId;
      setLogs(await api.auditLogs(params));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWarehouseId, start, end]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Audit Logs</h2>

      <div className="flex items-center gap-2">
        <SearchInput value={action} onChange={setAction} placeholder="Search by action..." className="flex-1" />
        <Button variant="outline" onClick={() => setFilterOpen(true)} className="shrink-0">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!logs && !error && <Skeleton className="h-64" />}
      {logs && logs.length === 0 && <EmptyState title="No audit records found." />}

      {logs && logs.length > 0 && (
        <Card className="divide-y divide-stone-100 dark:divide-stone-800">
          {logs.map((l) => (
            <div key={l.id} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-stone-800 dark:text-stone-100">{l.action}</p>
                <span className="shrink-0 text-xs text-stone-400">{new Date(l.created_at).toLocaleString()}</span>
              </div>
              <p className="text-xs text-stone-500">{l.user_name}</p>
              {l.details && (
                <p className="mt-1 truncate text-xs text-stone-400">
                  {Object.entries(JSON.parse(l.details))
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </p>
              )}
            </div>
          ))}
        </Card>
      )}

      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Audit Logs">
        <div className="space-y-4">
          <Input label="From Date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="To Date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setStart("");
                setEnd("");
              }}
            >
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
