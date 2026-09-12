import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Eye, EyeOff, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { Button, Input } from "../components/ui.jsx";

const emptyForm = {
  companyName: "",
  currencySymbol: "Rs.",
  adminName: "",
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export default function Setup() {
  const { completeSetup, pushToast } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1 = company, 2 = admin account
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const goToStep2 = (e) => {
    e.preventDefault();
    setError("");
    if (!form.companyName.trim()) return setError("Company name is required.");
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.adminName.trim()) return setError("Your name is required.");
    if (form.username.trim().length < 3) return setError("Username must be at least 3 characters.");
    if (!/^[a-zA-Z0-9_.-]+$/.test(form.username.trim())) {
      return setError("Username can only contain letters, numbers, dots, hyphens, and underscores.");
    }
    if (form.password.length < 6) return setError("Password must be at least 6 characters.");
    if (form.password !== form.confirmPassword) return setError("Passwords do not match.");
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError("Please enter a valid email address.");

    setLoading(true);
    try {
      await completeSetup({
        companyName: form.companyName.trim(),
        currencySymbol: form.currencySymbol.trim() || "Rs.",
        adminName: form.adminName.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      pushToast(`Welcome to Timber Storage Pro, ${form.adminName.trim().split(" ")[0]}!`);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-950 px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary-600/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="grid-fade absolute inset-0 opacity-40" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 via-primary-600 to-primary-800 shadow-[0_0_40px_-8px_rgba(124,94,60,0.65)]">
            <Building2 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-50">Set Up Timber Storage Pro</h1>
          <p className="mt-1 text-sm text-stone-400">Let's create your company and your admin account. This only happens once.</p>
        </div>

        {/* Step indicator */}
        <div className="mb-5 flex items-center justify-center gap-2">
          <StepDot active={step === 1} done={step > 1} label="1" />
          <div className={`h-0.5 w-10 rounded ${step > 1 ? "bg-primary-500" : "bg-stone-700"}`} />
          <StepDot active={step === 2} done={false} label="2" />
        </div>

        <div className="rounded-2xl border border-stone-800 bg-stone-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {error && <div className="mb-4 rounded-xl border border-red-900/60 bg-red-950/50 px-3 py-2.5 text-sm text-red-400">{error}</div>}

          {step === 1 && (
            <form onSubmit={goToStep2} className="space-y-4">
              <p className="text-sm font-semibold text-stone-200">Your Company</p>
              <Input label="Company / Business Name" required autoFocus value={form.companyName} onChange={set("companyName")} placeholder="Acme Timber Co." />
              <Input label="Currency Symbol" value={form.currencySymbol} onChange={set("currencySymbol")} placeholder="Rs." />
              <p className="text-xs text-stone-500">You can change these later from Settings once you're logged in.</p>
              <Button type="submit" className="w-full">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-stone-200">Your Admin Account</p>
                <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-300">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
              </div>
              <Input label="Full Name" required autoFocus value={form.adminName} onChange={set("adminName")} placeholder="Jane Admin" />
              <Input label="Username" required value={form.username} onChange={set("username")} placeholder="jane" />
              <Input label="Email (optional)" type="email" value={form.email} onChange={set("email")} placeholder="jane@acmetimber.com" />
              <div className="relative">
                <Input
                  label="Password"
                  required
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={set("password")}
                  placeholder="At least 6 characters"
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
              <Input
                label="Confirm Password"
                required
                type={showPassword ? "text" : "password"}
                value={form.confirmPassword}
                onChange={set("confirmPassword")}
                placeholder="Re-enter your password"
              />
              <Button type="submit" className="w-full" loading={loading}>
                <CheckCircle2 className="h-4 w-4" /> Create Account & Get Started
              </Button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-stone-500">
          This creates one Super Admin account for {form.companyName || "your company"} — no demo data. You'll add your own
          warehouses, parties, and containers after logging in.
        </p>
      </div>
    </div>
  );
}

function StepDot({ active, done, label }) {
  return (
    <div
      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
        active ? "bg-primary-600 text-white" : done ? "bg-forest-500/20 text-forest-400" : "bg-stone-800 text-stone-400"
      }`}
    >
      {done ? <CheckCircle2 className="h-4 w-4" /> : label}
    </div>
  );
}
