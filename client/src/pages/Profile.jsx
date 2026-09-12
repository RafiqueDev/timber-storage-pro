import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { Card, Badge, Button, Input } from "../components/ui.jsx";

const ROLE_LABEL = { SUPER_ADMIN: "Super Admin", BRANCH_MANAGER: "Branch Manager", STAFF: "Staff" };

export default function Profile() {
  const { user, warehouses, logout, pushToast } = useApp();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (password.length < 6) return pushToast("New password must be at least 6 characters.", "error");
    if (password !== confirmPassword) return pushToast("Passwords do not match.", "error");
    setSaving(true);
    try {
      await api.resetPassword(user.id, password);
      pushToast("Password changed successfully.");
      setPassword("");
      setConfirmPassword("");
    } catch (e2) {
      pushToast(e2.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Profile</h2>

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/50 text-xl font-bold text-primary-700 dark:text-primary-300">
            {user?.name?.[0]}
          </div>
          <div>
            <p className="font-semibold text-stone-900 dark:text-stone-50">{user?.name}</p>
            <p className="text-sm text-stone-500">@{user?.username}</p>
            <Badge tone="primary">{ROLE_LABEL[user?.role]}</Badge>
          </div>
        </div>
        <div className="mt-4 space-y-2 border-t border-stone-100 dark:border-stone-800 pt-4 text-sm">
          <p className="text-stone-500">
            Email: <span className="text-stone-800 dark:text-stone-100">{user?.email || "—"}</span>
          </p>
          <p className="text-stone-500">
            Assigned Warehouses:{" "}
            <span className="text-stone-800 dark:text-stone-100">
              {user?.role === "SUPER_ADMIN" ? "All warehouses" : warehouses.map((w) => w.branch_name).join(", ") || "None"}
            </span>
          </p>
        </div>
      </Card>

      <form onSubmit={changePassword}>
        <Card className="space-y-4 p-5">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Change Password</h3>
          <Input label="New Password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Confirm New Password" type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Update Password
            </Button>
          </div>
        </Card>
      </form>

      <Button variant="outline" className="w-full" onClick={handleLogout}>
        <LogOut className="h-4 w-4" /> Logout
      </Button>
    </div>
  );
}
