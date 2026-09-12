import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { Button, Input } from "../components/ui.jsx";

export default function Login() {
  const { login, pushToast } = useApp();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      pushToast("Welcome back!");
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    // The `dark` class is forced here on purpose — Tailwind's dark: variants
    // apply to any descendant of an ancestor carrying that class, not only
    // <html>, so this scopes a deliberately rich, dark login screen
    // regardless of the signed-out visitor's light/dark app preference
    // (which doesn't even exist yet for them — they haven't logged in).
    <div className="dark relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-950 px-4">
      {/* Layered glow background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary-600/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="grid-fade absolute inset-0 opacity-40" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 via-primary-600 to-primary-800 shadow-[0_0_40px_-8px_rgba(124,94,60,0.65)]">
            <Package className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-50">Timber Storage Pro</h1>
          <p className="mt-1 text-sm text-stone-400">Multi-branch warehouse & storage management</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          {error && <div className="rounded-xl bg-red-950/50 border border-red-900/60 px-3 py-2.5 text-sm text-red-400">{error}</div>}
          <Input label="Username or Email" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
          <div className="relative">
            <Input
              label="Password"
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-9 touch-target text-stone-500 hover:text-stone-300"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-stone-400">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-stone-600 bg-stone-800" />
              Remember Me
            </label>
            <button type="button" className="font-medium text-primary-400 hover:text-primary-300 hover:underline">
              Forgot Password?
            </button>
          </div>
          <Button type="submit" className="w-full" loading={loading}>
            Login
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-stone-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          Every warehouse is access-controlled and fully audited.
        </div>

        <div className="mt-5 rounded-xl border border-stone-800 bg-stone-900/60 p-4 text-xs text-stone-400 backdrop-blur">
          <p className="mb-1 font-semibold text-stone-300">Demo accounts (after running the seed script):</p>
          <p>admin / admin123 — Super Admin</p>
          <p>manager / manager123 — Branch Manager</p>
          <p>staff / staff123 — Staff</p>
        </div>
      </div>
    </div>
  );
}
