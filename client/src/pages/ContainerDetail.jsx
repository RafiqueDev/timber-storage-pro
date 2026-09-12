import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Truck, Receipt, History, PackageX, Printer, Pencil, Undo2, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import { useApp } from "../context/AppContext.jsx";
import { printSection } from "../lib/print.js";
import EditLoadingModal from "../components/EditLoadingModal.jsx";
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  Textarea,
  ConfirmDialog,
  useConfirm,
  formatCurrency,
  formatDate,
  ErrorState,
  Skeleton,
  PrintHeaderFooter,
} from "../components/ui.jsx";

export default function ContainerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { pushToast, setBreadcrumbExtra, companyName, developerName } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const [form, setForm] = useState({ date_of_loading: new Date().toISOString().slice(0, 10), packets_loading: "", vehicle_number: "", driver_number: "", description: "" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const { confirmState, confirm, close } = useConfirm();

  const load = async () => {
    setError("");
    try {
      const d = await api.container(id);
      setData(d);
      setBreadcrumbExtra(d.container_number);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    return () => setBreadcrumbExtra(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const submitLoading = async (e) => {
    e.preventDefault();
    setFormError("");
    const qty = +form.packets_loading;
    if (!(qty > 0)) return setFormError("Please enter a valid loading quantity.");
    if (qty > data.remaining_packets) return setFormError(`Loading quantity cannot exceed remaining bundles (${data.remaining_packets} available).`);
    confirm({
      title: "Confirm loading",
      description: `Record ${qty} bundles as loaded from ${data.container_number}?`,
      confirmLabel: "Record Loading",
      danger: false,
      onConfirm: async () => {
        setSaving(true);
        try {
          await api.recordLoading({ container_id: id, date_of_loading: form.date_of_loading, packets_loaded: qty, vehicle_number: form.vehicle_number, driver_number: form.driver_number, description: form.description });
          pushToast("Loading recorded successfully.");
          close();
          setLoadOpen(false);
          setForm({ date_of_loading: new Date().toISOString().slice(0, 10), packets_loading: "", vehicle_number: "", driver_number: "", description: "" });
          load();
        } catch (e2) {
          pushToast(e2.message, "error");
          close();
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const handleClear = () => {
    confirm({
      title: "Clear container",
      description: `Mark ${data.container_number} as cleared? This cannot be easily undone.`,
      confirmLabel: "Clear Container",
      onConfirm: async () => {
        try {
          await api.clearContainer(id);
          pushToast("Container cleared.");
          close();
          load();
        } catch (e2) {
          pushToast(e2.message, "error");
          close();
        }
      },
    });
  };

  const handleUndoContainer = () => {
    confirm({
      title: "Undo container",
      description: `Permanently remove ${data.container_number}? This can only be done because it has no loading or billing history yet.`,
      confirmLabel: "Undo Container",
      onConfirm: async () => {
        try {
          await api.deleteContainer(id);
          pushToast("Container undone.");
          close();
          navigate("/containers");
        } catch (e2) {
          pushToast(e2.message, "error");
          close();
        }
      },
    });
  };

  const handleUndoLoading = (log) => {
    confirm({
      title: "Undo loading record",
      description: `Remove this loading entry (${log.packets_loaded} bundles on ${formatDate(log.date_of_loading)})? The container's totals will be recalculated.`,
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

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton className="h-96" />;

  const canUndoContainer = data.loadingHistory.length === 0 && data.billingHistory.length === 0;

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-700">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <Button size="sm" variant="outline" onClick={() => printSection("container-print-area")}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>

      <div id="container-print-area">
        <PrintHeaderFooter companyName={companyName} developerName={developerName} />
        <Card className="p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">{data.container_number}</h2>
              <p className="text-sm text-stone-500">
                {data.party?.party_name} · {data.warehouse?.branch_name}
              </p>
            </div>
            <Badge tone={data.status === "Active" ? "success" : "neutral"}>{data.status}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 border-y border-stone-100 dark:border-stone-800 py-4 sm:grid-cols-4">
            <Info label="Arrival Date" value={formatDate(data.date_of_unloading)} />
            <Info label="Initial Bundles" value={data.initial_packets} />
            <Info label="Loaded Bundles" value={data.loaded_packets} />
            <Info label="Remaining Bundles" value={data.remaining_packets} highlight />
            <Info label="Rent Type" value={data.rent_type} />
            <Info label="Rent Rate" value={formatCurrency(data.rent_rate)} />
            <Info label="Days Accrued" value={data.default_billable_days} />
            <Info label="Accrued Rent" value={formatCurrency(data.accrued_rent)} highlight />
            {data.status === "Cleared" && (
              <>
                <Info label="Last Loading Date" value={data.last_loading_date ? formatDate(data.last_loading_date) : "—"} />
                <Info label="Cleared On" value={data.cleared_at ? new Date(data.cleared_at + "Z").toLocaleDateString() : "—"} />
              </>
            )}
          </div>

          <div className="no-print mt-4 flex flex-wrap gap-2">
            <Button disabled={data.status !== "Active"} onClick={() => setLoadOpen(true)}>
              <Truck className="h-4 w-4" /> Record Loading
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/billing?party=${data.party_id}&warehouse=${data.warehouse_id}`)}>
              <Receipt className="h-4 w-4" /> Generate Bill
            </Button>
            {data.status === "Active" && (
              <Button variant="outline" onClick={handleClear}>
                <PackageX className="h-4 w-4" /> Clear Container
              </Button>
            )}
            {canUndoContainer && (
              <Button variant="ghost" onClick={handleUndoContainer}>
                <Undo2 className="h-4 w-4" /> Undo Container
              </Button>
            )}
          </div>
        </Card>

        <Card className="mt-5 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
            <History className="h-4 w-4" /> Loading History
            {data.status === "Cleared" && (
              <span className="ml-auto text-xs font-normal text-stone-400">Finished on {formatDate(data.last_loading_date)}</span>
            )}
          </div>
          {data.loadingHistory.length === 0 && <p className="text-sm text-stone-400">No loading recorded yet.</p>}
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {data.loadingHistory.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-stone-800 dark:text-stone-100">{l.packets_loaded} bundles</p>
                  <p className="truncate text-xs text-stone-400">
                    {formatDate(l.date_of_loading)} · {l.vehicle_number || "No vehicle"}
                    {l.driver_number ? ` · ${l.driver_number}` : ""}
                  </p>
                </div>
                <div className="no-print flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setEditingLog({ ...l, container_number: data.container_number })}
                    className="touch-target rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-primary-600 dark:hover:bg-stone-800"
                    aria-label="Edit loading record"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleUndoLoading(l)}
                    className="touch-target rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                    aria-label="Undo loading record"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-5 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
            <Receipt className="h-4 w-4" /> Billing History
          </div>
          {data.billingHistory.length === 0 && <p className="text-sm text-stone-400">No invoices generated for this container yet.</p>}
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {data.billingHistory.map((b) => (
              <Link key={b.id} to={`/invoices/${b.invoice_id}`} className="print:pointer-events-none flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium text-stone-800 dark:text-stone-100">{b.invoice_number}</p>
                  <p className="text-xs text-stone-400">
                    {formatDate(b.billing_start)} → {formatDate(b.billing_end)} ({b.billable_days} days)
                  </p>
                </div>
                <span className="font-semibold text-stone-700 dark:text-stone-200">{formatCurrency(b.calculated_rent)}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Modal open={loadOpen} onClose={() => setLoadOpen(false)} title="Record Loading">
        <form onSubmit={submitLoading} className="space-y-4">
          {formError && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{formError}</div>}
          <div className="rounded-xl bg-stone-100 dark:bg-stone-800 px-4 py-3 text-sm">
            Available: <span className="font-semibold">{data.remaining_packets} bundles</span>
          </div>
          <Input label="Bundles Loading" required type="number" min="1" max={data.remaining_packets} value={form.packets_loading} onChange={(e) => setForm({ ...form, packets_loading: e.target.value })} />
          <Input label="Vehicle Number" value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} placeholder="TLB-4521" />
          <Input label="Driver Number" value={form.driver_number} onChange={(e) => setForm({ ...form, driver_number: e.target.value })} placeholder="0301-2223334" />
          <Input label="Date" required type="date" value={form.date_of_loading} onChange={(e) => setForm({ ...form, date_of_loading: e.target.value })} />
          <Textarea label="Description (optional)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setLoadOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Record Loading
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmState.open}
        onClose={close}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        danger={confirmState.danger}
      />

      <EditLoadingModal log={editingLog} open={!!editingLog} onClose={() => setEditingLog(null)} onSaved={load} pushToast={pushToast} />
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
