import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { Modal, Button, Input, Textarea, formatDate } from "./ui.jsx";

/**
 * Reusable "Edit Loading Record" modal, used from both the Loading History
 * page and a container's own detail page. Recalculates the container's
 * loaded/remaining totals server-side from ALL of its logs after the edit,
 * so numbers can never drift regardless of how many times a record is
 * corrected.
 */
export default function EditLoadingModal({ log, open, onClose, onSaved, pushToast }) {
  const [form, setForm] = useState({ date_of_loading: "", packets_loaded: "", vehicle_number: "", driver_number: "", description: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (log) {
      setForm({
        date_of_loading: log.date_of_loading,
        packets_loaded: String(log.packets_loaded),
        vehicle_number: log.vehicle_number || "",
        driver_number: log.driver_number || "",
        description: log.description || "",
      });
      setError("");
    }
  }, [log]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const qty = +form.packets_loaded;
    if (!(qty > 0)) return setError("Please enter a valid loading quantity.");
    setSaving(true);
    try {
      await api.updateLoadingLog(log.id, form);
      pushToast?.("Loading record updated successfully.");
      onSaved?.();
      onClose();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  if (!log) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Edit Loading — ${log.container_number || ""}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{error}</div>}
        <p className="text-xs text-stone-400">
          Originally recorded {formatDate(log.date_of_loading)} — {log.packets_loaded} bundles. Editing this recalculates the
          container's totals from its full loading history.
        </p>
        <Input label="Bundles Loaded" required type="number" min="1" value={form.packets_loaded} onChange={(e) => setForm({ ...form, packets_loaded: e.target.value })} />
        <Input label="Date" required type="date" value={form.date_of_loading} onChange={(e) => setForm({ ...form, date_of_loading: e.target.value })} />
        <Input label="Vehicle Number" value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} />
        <Input label="Driver Number" value={form.driver_number} onChange={(e) => setForm({ ...form, driver_number: e.target.value })} />
        <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
