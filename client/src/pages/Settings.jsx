import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { Card, Button, Input, Select, ErrorState, Skeleton } from "../components/ui.jsx";

export default function Settings() {
  const { isAdmin, theme, setTheme, pushToast, setCompany } = useApp();
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError("");
    try {
      setForm(await api.settings());
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateSettings(form);
      setCompany(updated);
      pushToast("Settings saved successfully.");
    } catch (e2) {
      pushToast(e2.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const onLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) return pushToast("Please choose a logo under 500KB.", "error");
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo: reader.result }));
    reader.readAsDataURL(file);
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!form) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Settings</h2>

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-200">Appearance</h3>
        <div className="flex items-center justify-between">
          <p className="text-sm text-stone-500">Dark Mode</p>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={`h-7 w-12 rounded-full transition-colors ${theme === "dark" ? "bg-primary-600" : "bg-stone-300"}`}
          >
            <span className={`block h-5 w-5 translate-x-1 rounded-full bg-white transition-transform ${theme === "dark" ? "translate-x-6" : ""}`} />
          </button>
        </div>
      </Card>

      {isAdmin ? (
        <form onSubmit={submit}>
          <Card className="space-y-4 p-5">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">System Settings</h3>
            <Input label="Company / System Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div>
              <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">Company Logo</span>
              <div className="flex items-center gap-3">
                {form.logo && <img src={form.logo} alt="Logo preview" className="h-12 w-12 rounded-lg border border-stone-200 object-contain dark:border-stone-700" />}
                <input type="file" accept="image/*" onChange={onLogoChange} className="text-sm text-stone-500" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Currency Code" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              <Input label="Currency Symbol" value={form.currency_symbol} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} />
              <Input label="Invoice Prefix" value={form.invoice_prefix} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })} />
              <Select label="Date Format" value={form.date_format} onChange={(e) => setForm({ ...form, date_format: e.target.value })}>
                <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                <option value="MM-DD-YYYY">MM-DD-YYYY</option>
              </Select>
              <Input label="Timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              <Input label="Low Stock Threshold" type="number" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} />
            </div>
            <Input
              label="Developer / Print Footer Credit"
              value={form.developer_name || ""}
              onChange={(e) => setForm({ ...form, developer_name: e.target.value })}
              placeholder="Shown at the bottom of printed pages"
            />
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>
                Save Settings
              </Button>
            </div>
          </Card>
        </form>
      ) : (
        <Card className="p-5 text-sm text-stone-500">Contact your Super Admin to change system-wide settings.</Card>
      )}
    </div>
  );
}
