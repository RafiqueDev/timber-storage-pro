import React, { useEffect, useState } from "react";
import { X, ChevronDown, Search as SearchIcon, Inbox, AlertTriangle } from "lucide-react";

export function Button({ children, variant = "primary", size = "md", className = "", loading, ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors touch-target disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary: "bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-md shadow-primary-600/20 hover:shadow-lg hover:shadow-primary-600/30 hover:brightness-105 active:brightness-95",
    secondary: "bg-stone-100 text-stone-800 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "bg-transparent text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800",
    outline: "border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-800",
  };
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2.5 text-sm", lg: "px-5 py-3 text-base" };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Input({ label, error, className = "", required, ...props }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">
          {label} {required && <span className="text-red-500">*</span>}
        </span>
      )}
      <input
        className={`w-full touch-target rounded-xl border px-3.5 py-2.5 text-base outline-none transition-colors
          bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100
          ${error ? "border-red-400 focus:ring-2 focus:ring-red-200" : "border-stone-300 dark:border-stone-700 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900"}
          ${className}`}
        {...props}
      />
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}

export function Select({ label, error, children, className = "", required, ...props }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">
          {label} {required && <span className="text-red-500">*</span>}
        </span>
      )}
      <div className="relative">
        <select
          className={`w-full touch-target appearance-none rounded-xl border px-3.5 py-2.5 pr-9 text-base outline-none transition-colors
            bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100
            ${error ? "border-red-400" : "border-stone-300 dark:border-stone-700 focus:border-primary-500"} ${className}`}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      </div>
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}

export function Textarea({ label, className = "", ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{label}</span>}
      <textarea
        className={`w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-base text-stone-900 dark:text-stone-100 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900 ${className}`}
        {...props}
      />
    </label>
  );
}

export function Card({ children, className = "", ...props }) {
  return (
    <div
      className={`rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm transition-shadow hover:shadow-md ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    success: "bg-forest-500/10 text-forest-600 dark:text-forest-500",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    danger: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    primary: "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function StatCard({ label, value, sub, icon: Icon, tone = "primary" }) {
  const tones = {
    primary: "text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300",
    forest: "text-forest-600 bg-forest-500/10",
    amber: "text-amber-600 bg-amber-50 dark:bg-amber-900/20",
    red: "text-red-600 bg-red-50 dark:bg-red-900/20",
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-stone-900 dark:text-stone-50">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-stone-400">{sub}</p>}
        </div>
        {Icon && (
          <div className={`rounded-xl p-2 ${tones[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Card>
  );
}

export function EmptyState({ title = "Nothing here yet", description, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 dark:border-stone-700 py-14 px-6 text-center">
      <div className="mb-3 rounded-full bg-stone-100 dark:bg-stone-800 p-3">
        <Icon className="h-6 w-6 text-stone-400" />
      </div>
      <p className="font-medium text-stone-700 dark:text-stone-200">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-stone-500 dark:text-stone-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-lg bg-stone-200 dark:bg-stone-800 ${className}`} />;
}

export function CardSkeletonGrid({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong.", onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 py-10 px-6 text-center">
      <AlertTriangle className="mb-2 h-6 w-6 text-red-500" />
      <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = "md" }) {
  if (!open) return null;
  const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className={`w-full ${sizes[size]} max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-stone-900 shadow-xl animate-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-5 py-4">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50">{title}</h3>
          <button onClick={onClose} className="touch-target rounded-full p-1 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function BottomSheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white dark:bg-stone-900 shadow-xl animate-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-stone-300 dark:bg-stone-700" />
        <div className="flex items-center justify-between px-5 py-3">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50">{title}</h3>
          <button onClick={onClose} className="touch-target rounded-full p-1 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 pb-8">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title = "Are you sure?", description, confirmLabel = "Confirm", danger = true, loading }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-stone-600 dark:text-stone-300">{description}</p>
    </Modal>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search...", className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full touch-target rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 py-2.5 pl-9 pr-3 text-sm text-stone-900 dark:text-stone-100 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900"
      />
    </div>
  );
}

export function ToastStack({ toasts }) {
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg animate-in ${
            t.variant === "error" ? "bg-red-600 text-white" : "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Table({ columns, rows, keyField = "id", empty }) {
  if (!rows?.length) return empty || <EmptyState />;
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800 lg:block">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 dark:bg-stone-900 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {rows.map((row) => (
            <tr key={row[keyField]} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3 text-stone-700 dark:text-stone-300">
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Drop inside a `.print-scope-target` element — invisible on screen, shows
 * only the company name (top) and developer credit (bottom) while printing. */
export function PrintHeaderFooter({ companyName, developerName }) {
  return (
    <>
      <div className="print-header-name">{companyName}</div>
      <div className="print-footer-dev">{developerName}</div>
    </>
  );
}

export function useConfirm() {
  const [state, setState] = useState({ open: false });
  const confirm = ({ title, description, onConfirm, confirmLabel, danger }) =>
    setState({ open: true, title, description, onConfirm, confirmLabel, danger });
  const close = () => setState((s) => ({ ...s, open: false }));
  return { confirmState: state, confirm, close };
}

export function formatCurrency(amount, symbol = "Rs.") {
  const n = Number(amount || 0);
  return `${symbol} ${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
}

export function formatDate(iso, fmt = "DD-MM-YYYY") {
  if (!iso) return "-";
  const d = new Date(iso + (iso.length <= 10 ? "T00:00:00" : ""));
  if (isNaN(d)) return iso;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  if (fmt === "MM-DD-YYYY") return `${month}-${day}-${year}`;
  return `${day}-${month}-${year}`;
}
