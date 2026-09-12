import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Boxes, PackageCheck, CheckCircle2, ChevronRight, Filter, Trash2 } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { Card, Badge, Button, Modal, Input, Select, Textarea, SearchInput, BottomSheet, ConfirmDialog, useConfirm, EmptyState, ErrorState, Skeleton } from "../components/ui.jsx";

const emptyForm = { party_name: "", contact_person: "", phone: "", alternate_phone: "", address: "", notes: "" };

export default function Parties() {
  const { pushToast, warehouses, activeWarehouseId } = useApp();
  const navigate = useNavigate();
  const [parties, setParties] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState(activeWarehouseId !== "all" ? activeWarehouseId : "");
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const { confirmState, confirm, close } = useConfirm();

  const load = async () => {
    setError("");
    try {
      setParties(await api.parties({ search: search || undefined, status: status || undefined, warehouse_id: warehouseFilter || undefined }));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, warehouseFilter]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.party_name.trim()) return setFormError("Party name is required.");
    setSaving(true);
    try {
      await api.createParty(form);
      pushToast("Party added successfully.");
      setAddOpen(false);
      setForm(emptyForm);
      load();
    } catch (e2) {
      setFormError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = (e, p) => {
    e.stopPropagation();
    confirm({
      title: "Undo party",
      description: `Permanently remove ${p.party_name}? This can only be done because it has no containers yet.`,
      confirmLabel: "Undo Party",
      onConfirm: async () => {
        try {
          await api.deleteParty(p.id);
          pushToast("Party undone.");
          close();
          load();
        } catch (e2) {
          pushToast(e2.message, "error");
          close();
        }
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Parties</h2>
        <Button
          size="sm"
          onClick={() => {
            setForm(emptyForm);
            setFormError("");
            setAddOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Add Party
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search parties..." className="flex-1" />
        <Button variant="outline" onClick={() => setFilterOpen(true)} className="shrink-0">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!parties && !error && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {parties && parties.length === 0 && (
        <EmptyState
          title="No parties found."
          description="Add a party/customer to start assigning containers."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add Party
            </Button>
          }
        />
      )}

      {parties && parties.length > 0 && (
        <div className="space-y-3">
          {parties.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer p-4"
              onClick={() => navigate(`/parties/${p.id}`)}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 sm:w-56 sm:shrink-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-stone-900 dark:text-stone-50">{p.party_name}</p>
                    <Badge tone={p.status === "Active" ? "success" : "neutral"}>{p.status}</Badge>
                  </div>
                  <p className="truncate text-xs text-stone-400">
                    {p.contact_person}
                    {p.contact_person && p.phone ? " · " : ""}
                    {p.phone}
                  </p>
                </div>

                {/* Container counts, side by side */}
                <div className="grid flex-1 grid-cols-3 gap-2 sm:max-w-md">
                  <Stat icon={Boxes} label="Total" value={p.totalContainers} />
                  <Stat icon={PackageCheck} label="Active" value={p.activeContainers} tone="text-primary-600" />
                  <Stat icon={CheckCircle2} label="Cleared" value={p.clearedContainers} tone="text-forest-600" />
                </div>

                <ChevronRight className="hidden h-5 w-5 shrink-0 text-stone-300 sm:block" />
                {p.totalContainers === 0 && (
                  <button
                    onClick={(e) => handleUndo(e, p)}
                    className="no-print shrink-0 touch-target rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                    aria-label="Undo party"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Parties">
        <div className="space-y-4">
          <Select label="Warehouse" value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
            <option value="">All Warehouses (container counts across all branches)</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.branch_name}
              </option>
            ))}
          </Select>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setStatus("");
                setWarehouseFilter("");
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Party">
        <form onSubmit={submit} className="space-y-4">
          {formError && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{formError}</div>}
          <Input label="Party Name" required value={form.party_name} onChange={(e) => setForm({ ...form, party_name: e.target.value })} />
          <Input label="Contact Person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="Alternate Phone" value={form.alternate_phone} onChange={(e) => setForm({ ...form, alternate_phone: e.target.value })} />
          </div>
          <Textarea label="Address" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Party
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
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = "text-stone-700 dark:text-stone-200" }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 dark:bg-stone-800">
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0 leading-tight">
        <p className={`text-sm font-bold ${tone}`}>{value}</p>
        <p className="truncate text-[10px] uppercase tracking-wide text-stone-400">{label}</p>
      </div>
    </div>
  );
}
