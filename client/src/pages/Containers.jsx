import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Filter } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import {
  Button,
  Card,
  Badge,
  Modal,
  Input,
  Select,
  Textarea,
  SearchInput,
  BottomSheet,
  EmptyState,
  ErrorState,
  Skeleton,
  Table,
  formatCurrency,
  formatDate,
} from "../components/ui.jsx";

const emptyForm = {
  warehouse_id: "",
  party_id: "",
  container_number: "",
  date_of_unloading: new Date().toISOString().slice(0, 10),
  initial_packets: "",
  rent_type: "Daily",
  rent_rate: "",
  notes: "",
};

export default function Containers() {
  const { activeWarehouseId, warehouses, pushToast } = useApp();
  const navigate = useNavigate();
  const [containers, setContainers] = useState(null);
  const [parties, setParties] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError("");
    try {
      const params = { search: search || undefined, status: status || undefined };
      if (activeWarehouseId !== "all") params.warehouse_id = activeWarehouseId;
      const [c, p] = await Promise.all([api.containers(params), parties.length ? Promise.resolve(parties) : api.parties()]);
      setContainers(c);
      setParties((prev) => (prev.length ? prev : p));
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

  const openAdd = () => {
    setForm({ ...emptyForm, warehouse_id: activeWarehouseId !== "all" ? activeWarehouseId : warehouses[0]?.id || "" });
    setFormError("");
    setAddOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.warehouse_id || !form.party_id) return setFormError("Warehouse and party are required.");
    if (!form.container_number.trim()) return setFormError("Container number cannot be empty.");
    if (!(+form.initial_packets > 0)) return setFormError("Initial packets must be greater than 0.");
    if (+form.rent_rate < 0 || form.rent_rate === "") return setFormError("Rent rate cannot be negative.");
    setSaving(true);
    try {
      await api.createContainer(form);
      pushToast("Container added successfully.");
      setAddOpen(false);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: "container_number", label: "Container", render: (r) => <span className="font-medium text-stone-900 dark:text-stone-50">{r.container_number}</span> },
    { key: "party", label: "Party", render: (r) => parties.find((p) => p.id === r.party_id)?.party_name || "-" },
    { key: "warehouse", label: "Warehouse", render: (r) => warehouses.find((w) => w.id === r.warehouse_id)?.branch_name || "-" },
    { key: "arrival", label: "Arrival", render: (r) => formatDate(r.date_of_unloading) },
    { key: "remaining", label: "Remaining", render: (r) => `${r.remaining_packets} / ${r.initial_packets}` },
    { key: "rent", label: "Rent", render: (r) => `${r.rent_type} — ${formatCurrency(r.rent_rate)}` },
    {
      key: "status",
      label: "Status",
      render: (r) => <Badge tone={r.status === "Active" ? "success" : "neutral"}>{r.status}</Badge>,
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => navigate(`/containers/${r.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Containers</h2>
        <Button onClick={openAdd} size="sm">
          <Plus className="h-4 w-4" /> Add Container
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search container number..." className="flex-1" />
        <Button variant="outline" size="md" onClick={() => setFilterOpen(true)} className="shrink-0 lg:hidden">
          <Filter className="h-4 w-4" />
        </Button>
        <div className="hidden lg:block">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!py-2">
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Cleared">Cleared</option>
          </Select>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!containers && !error && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      )}

      {containers && containers.length === 0 && (
        <EmptyState
          title="No active containers found."
          description="Add your first container to start tracking storage and billing."
          action={
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add Container
            </Button>
          }
        />
      )}

      {containers && containers.length > 0 && (
        <>
          {/* MOBILE CARDS */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
            {containers.map((c) => (
              <Card key={c.id} className="p-4" onClick={() => navigate(`/containers/${c.id}`)}>
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-stone-900 dark:text-stone-50">{c.container_number}</p>
                    <p className="text-xs text-stone-500">{parties.find((p) => p.id === c.party_id)?.party_name}</p>
                  </div>
                  <Badge tone={c.status === "Active" ? "success" : "neutral"}>{c.status}</Badge>
                </div>
                <p className="mb-3 text-xs text-stone-400">{warehouses.find((w) => w.id === c.warehouse_id)?.branch_name}</p>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
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
                <div className="flex items-center justify-between border-t border-stone-100 dark:border-stone-800 pt-3 text-xs text-stone-500">
                  <span>
                    {c.rent_type} — {formatCurrency(c.rent_rate)}
                  </span>
                  <span className="font-medium text-primary-600">View →</span>
                </div>
              </Card>
            ))}
          </div>

          {/* DESKTOP TABLE */}
          <Table columns={columns} rows={containers} />
        </>
      )}

      {/* MOBILE FILTER SHEET */}
      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Containers">
        <div className="space-y-4">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Cleared">Cleared</option>
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

      {/* ADD CONTAINER MODAL */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Container" size="lg">
        <form onSubmit={submit} className="space-y-4">
          {formError && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{formError}</div>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Warehouse" required value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">Select warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.branch_name}
                </option>
              ))}
            </Select>
            <Select label="Party" required value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })}>
              <option value="">Select party</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.party_name}
                </option>
              ))}
            </Select>
            <Input label="Container Number" required value={form.container_number} onChange={(e) => setForm({ ...form, container_number: e.target.value })} placeholder="CONT-004" />
            <Input label="Unloading Date" required type="date" value={form.date_of_unloading} onChange={(e) => setForm({ ...form, date_of_unloading: e.target.value })} />
            <Input label="Initial Bundles / Packets" required type="number" min="1" value={form.initial_packets} onChange={(e) => setForm({ ...form, initial_packets: e.target.value })} />
            <Select label="Rent Type" required value={form.rent_type} onChange={(e) => setForm({ ...form, rent_type: e.target.value })}>
              <option value="Daily">Daily</option>
              <option value="Monthly">Monthly</option>
            </Select>
            <Input label="Rent Rate" required type="number" min="0" value={form.rent_rate} onChange={(e) => setForm({ ...form, rent_rate: e.target.value })} />
          </div>
          <Textarea label="Notes (optional)" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Container
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
