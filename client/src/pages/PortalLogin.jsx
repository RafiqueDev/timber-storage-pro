import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Eye, EyeOff } from "lucide-react";
import { api } from "../api/client.js";
import { Button, Input } from "../components/ui.jsx";

export default function PortalLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      const data = await api.portalLogin(username.trim(), password);
      sessionStorage.setItem("tsp_portal_token", data.token);
      sessionStorage.setItem("tsp_portal_party", JSON.stringify(data.party));
      sessionStorage.setItem("tsp_portal_expires", data.expiresAt);
      navigate("/portal/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-950 px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary-600/20 blur-3xl" />
        <div className="grid-fade absolute inset-0 opacity-40" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 via-primary-600 to-primary-800 shadow-[0_0_40px_-8px_rgba(124,94,60,0.65)]">
            <Package className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-stone-50">Party Portal</h1>
          <p className="mt-1 text-sm text-stone-400">Enter the username and password you were given to view your account.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {error && <div className="rounded-xl border border-red-900/60 bg-red-950/50 px-3 py-2.5 text-sm text-red-400">{error}</div>}
          <Input label="Username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          <div className="relative">
            <Input label="Password" required type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-9 touch-target text-stone-500 hover:text-stone-300" tabIndex={-1}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button type="submit" className="w-full" loading={loading}>
            View My Account
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-stone-500">This access was shared with you by your warehouse and expires 24 hours after it was created.</p>
      </div>
    </div>
  );
}
