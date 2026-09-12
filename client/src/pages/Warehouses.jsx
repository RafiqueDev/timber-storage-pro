import React, { useEffect, useState } from "react";
import { Plus, MapPin } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { Card, Badge, Button, Modal, Input, ConfirmDialog, useConfirm, EmptyState, ErrorState, Skeleton } from "../components/ui.jsx";

const emptyForm = { branch_name: "", branch_address: "", location: "", contact_number: "" };

export default function Warehouses() {
  const { isAdmin, pushToast, setWarehouses } = useApp();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const { confirmState, confirm, close } = useConfirm();

  const load = async () => {
    setError("");
    try {
      const rows = await api.warehouses();
      setList(rows);
      setWarehouses(rows);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAdmin) {
    return <EmptyState title="Administrator access required." description="Only Super Admins can manage warehouse branches." />;
  }

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setAddOpen(true);
  };

  const openEdit = (w) => {
    setEditing(w);
    setForm({ branch_name: w.branch_name, branch_address: w.branch_address || "", location: w.location || "", contact_number: w.contact_number || "" });
    setFormError("");
    setAddOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.branch_name.trim()) return setFormError("Branch name is required.");
    setSaving(true);
    try {
      if (editing) {
        await api.updateWarehouse(editing.id, form);
        pushToast("Warehouse updated successfully.");
      } else {
        await api.createWarehouse(form);
        pushToast("Warehouse added successfully.");
      }
      setAddOpen(false);
      load();
    } catch (e2) {
      setFormError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = (w) => {
    confirm({
      title: "Deactivate warehouse",
      description: `Deactivate ${w.branch_name}? It will no longer appear as an active option for new records.`,
      confirmLabel: "Deactivate",
      onConfirm: async () => {
        try {
          await api.deactivateWarehouse(w.id);
          pushToast("Warehouse deactivated.");
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
        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Warehouses</h2>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" /> Add Warehouse
        </Button>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!list && !error && <Skeleton className="h-48" />}
      {list && list.length === 0 && <EmptyState title="No warehouses yet." action={<Button onClick={openAdd}><Plus className="h-4 w-4" /> Add Warehouse</Button>} />}

      {list && list.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="mb-1 flex items-start justify-between">
                <p className="font-semibold text-stone-900 dark:text-stone-50">{w.branch_name}</p>
                <Badge tone={w.status === "Active" ? "success" : "neutral"}>{w.status}</Badge>
              </div>
              <p className="mb-2 flex items-center gap-1 text-xs text-stone-500">
                <MapPin className="h-3.5 w-3.5" /> {w.location}
              </p>
              <p className="mb-3 text-xs text-stone-400">{w.branch_address}</p>
              <p className="mb-3 text-xs text-stone-400">{w.contact_number}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(w)}>
                  Edit
                </Button>
                {w.status === "Active" && (
                  <Button size="sm" variant="ghost" onClick={() => handleDeactivate(w)}>
                    Deactivate
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={editing ? "Edit Warehouse" : "Add Warehouse"}>
        <form onSubmit={submit} className="space-y-4">
          {formError && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{formError}</div>}
          <Input label="Branch Name" required value={form.branch_name} onChange={(e) => setForm({ ...form, branch_name: e.target.value })} />
          <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Karachi" />
          <Input label="Address" value={form.branch_address} onChange={(e) => setForm({ ...form, branch_address: e.target.value })} />
          <Input label="Contact Number" value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save Changes" : "Save Warehouse"}
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
