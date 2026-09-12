import React, { useEffect, useState } from "react";
import { Filter, Pencil, Trash2 } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import EditLoadingModal from "../components/EditLoadingModal.jsx";
import { Card, SearchInput, Button, BottomSheet, Input, Table, ConfirmDialog, useConfirm, EmptyState, ErrorState, Skeleton, formatDate } from "../components/ui.jsx";

export default function LoadingHistory() {
  const { activeWarehouseId, pushToast } = useApp();
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const { confirmState, confirm, close } = useConfirm();

  const load = async () => {
    setError("");
    try {
      const params = { search: search || undefined, start: start || undefined, end: end || undefined };
      if (activeWarehouseId !== "all") params.warehouse_id = activeWarehouseId;
      setLogs(await api.loadingLogs(params));
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
  }, [search]);

  const handleUndo = (log) => {
    confirm({
      title: "Undo loading record",
      description: `Remove this entry — ${log.packets_loaded} bundles for ${log.container_number} on ${formatDate(log.date_of_loading)}? The container's totals will be recalculated.`,
      confirmLabel: "Undo Entry",
      onConfirm: async () => {
        try {
          await api.deleteLoadingLog(log.id);
          pushToast("Loading record undone.");
          close();
          load();
        } catch (e2) {
          pushToast(e2.message, "error");
          close();
        }
      },
    });
  };

  const columns = [
    { key: "date", label: "Date", render: (r) => formatDate(r.date_of_loading) },
    { key: "container_number", label: "Container" },
    { key: "party_name", label: "Party" },
    { key: "packets_loaded", label: "Bundles" },
    { key: "vehicle_number", label: "Vehicle" },
    { key: "driver_number", label: "Driver" },
    { key: "branch_name", label: "Warehouse" },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setEditingLog(r)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => handleUndo(r)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Loading History</h2>

      <div className="flex items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search container, party, vehicle..." className="flex-1" />
        <Button variant="outline" onClick={() => setFilterOpen(true)} className="shrink-0">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!logs && !error && <Skeleton className="h-64" />}
      {logs && logs.length === 0 && <EmptyState title="No loading records found." description="Record loading from a container's detail page." />}

      {logs && logs.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
            {logs.map((l) => (
              <Card key={l.id} className="p-4">
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-stone-900 dark:text-stone-50">{l.container_number}</p>
                  <span className="text-xs text-stone-400">{formatDate(l.date_of_loading)}</span>
                </div>
                <p className="mb-2 text-xs text-stone-500">{l.party_name}</p>
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-primary-600">{l.packets_loaded} bundles</span>
                  <span className="text-xs text-stone-400">{l.vehicle_number}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditingLog(l)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleUndo(l)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          <Table columns={columns} rows={logs} />
        </>
      )}

      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Loading History">
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

      <EditLoadingModal log={editingLog} open={!!editingLog} onClose={() => setEditingLog(null)} onSaved={load} pushToast={pushToast} />

      <ConfirmDialog
        open={confirmState.open}
        onClose={close}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        danger={confirmState.danger}
      />
    </div>
  );
}
