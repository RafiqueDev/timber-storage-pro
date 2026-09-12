import React, { useEffect, useState } from "react";
import { Plus, KeyRound } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { Card, Badge, Button, Modal, Input, Select, EmptyState, ErrorState, Skeleton } from "../components/ui.jsx";

const emptyForm = { name: "", username: "", email: "", password: "", role: "STAFF", warehouse_ids: [] };

const ROLE_LABEL = { SUPER_ADMIN: "Super Admin", BRANCH_MANAGER: "Branch Manager", STAFF: "Staff" };

export default function Users() {
  const { isAdmin, warehouses, setWarehouses, pushToast } = useApp();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(null);
  const [newPassword, setNewPassword] = useState("");

  const load = async () => {
    setError("");
    try {
      setUsers(await api.users());
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    // The header's warehouse selector only ever loads the CURRENT user's
    // warehouses at login. This page needs the full, current list so the
    // "Assign Warehouses" picker below is never stale or empty — fetch it
    // directly every time this page is opened rather than trusting the
    // cached context value.
    api
      .warehouses()
      .then(setWarehouses)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAdmin) {
    return <EmptyState title="Administrator access required." description="Only Super Admins can manage users." />;
  }

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setAddOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({ name: u.name, username: u.username, email: u.email || "", password: "", role: u.role, warehouse_ids: u.warehouses.map((w) => w.id) });
    setFormError("");
    setAddOpen(true);
  };

  const toggleWarehouse = (id) =>
    setForm((f) => ({
      ...f,
      warehouse_ids: f.warehouse_ids.includes(id) ? f.warehouse_ids.filter((w) => w !== id) : [...f.warehouse_ids, id],
    }));

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.name.trim() || !form.username.trim()) return setFormError("Name and username are required.");
    if (!editing && (!form.password || form.password.length < 6)) return setFormError("Password must be at least 6 characters.");
    setSaving(true);
    try {
      if (editing) {
        await api.updateUser(editing.id, { name: form.name, email: form.email, role: form.role, warehouse_ids: form.warehouse_ids });
        pushToast("User updated successfully.");
      } else {
        await api.createUser(form);
        pushToast("User created successfully.");
      }
      setAddOpen(false);
      load();
    } catch (e2) {
      setFormError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) return pushToast("New password must be at least 6 characters.", "error");
    try {
      await api.resetPassword(resetOpen.id, newPassword);
      pushToast("Password reset successfully.");
      setResetOpen(null);
      setNewPassword("");
    } catch (e2) {
      pushToast(e2.message, "error");
    }
  };

  const toggleStatus = async (u) => {
    try {
      await api.updateUser(u.id, { status: u.status === "Active" ? "Inactive" : "Active" });
      pushToast(`User ${u.status === "Active" ? "deactivated" : "activated"}.`);
      load();
    } catch (e2) {
      pushToast(e2.message, "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Users</h2>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" /> Create User
        </Button>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!users && !error && <Skeleton className="h-48" />}
      {users && users.length === 0 && <EmptyState title="No users yet." />}

      {users && users.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u) => (
            <Card key={u.id} className="p-4">
              <div className="mb-1 flex items-start justify-between">
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-50">{u.name}</p>
                  <p className="text-xs text-stone-500">@{u.username}</p>
                </div>
                <Badge tone={u.status === "Active" ? "success" : "neutral"}>{u.status}</Badge>
              </div>
              <Badge tone="primary">{ROLE_LABEL[u.role]}</Badge>
              <p className="mt-2 text-xs text-stone-400">
                {u.warehouses.length ? u.warehouses.map((w) => w.branch_name).join(", ") : u.role === "SUPER_ADMIN" ? "All warehouses" : "No warehouses assigned"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(u)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResetOpen(u)}>
                  <KeyRound className="h-3.5 w-3.5" /> Reset Password
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggleStatus(u)}>
                  {u.status === "Active" ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={editing ? "Edit User" : "Create User"} size="lg">
        <form onSubmit={submit} className="space-y-4">
          {formError && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{formError}</div>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Full Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Username" required disabled={!!editing} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {!editing && <Input label="Password" required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
            <Select label="Role" required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="BRANCH_MANAGER">Branch Manager</option>
              <option value="STAFF">Staff</option>
            </Select>
          </div>
          {form.role !== "SUPER_ADMIN" && (
            <div>
              <p className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">Assign Warehouses</p>
              {warehouses.length === 0 ? (
                <p className="rounded-xl bg-stone-100 px-3 py-2.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  No warehouses exist yet — add one from the Warehouses page first, then come back here to assign it.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {warehouses.map((w) => (
                    <button
                      type="button"
                      key={w.id}
                      onClick={() => toggleWarehouse(w.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                        form.warehouse_ids.includes(w.id)
                          ? "border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                          : "border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300"
                      }`}
                    >
                      {w.branch_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save Changes" : "Create User"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!resetOpen} onClose={() => setResetOpen(null)} title={`Reset Password — ${resetOpen?.name || ""}`}>
        <form onSubmit={submitReset} className="space-y-4">
          <Input label="New Password" required type="password" minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setResetOpen(null)}>
              Cancel
            </Button>
            <Button type="submit">Reset Password</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
