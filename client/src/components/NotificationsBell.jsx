import React, { useState, useRef, useEffect } from "react";
import { Bell, CheckCheck, PackageX, Receipt, Wallet, CheckCircle2, Info } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { BottomSheet } from "./ui.jsx";

const TYPE_ICON = {
  warning: PackageX,
  info: Receipt,
  success: CheckCircle2,
};

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso + "Z").getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NotificationList({ notifications, onRead, onReadAll }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-stone-400">{notifications.length === 0 ? "You're all caught up." : `${notifications.length} recent`}</p>
        {notifications.some((n) => !n.read) && (
          <button onClick={onReadAll} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        )}
      </div>
      <div className="max-h-80 divide-y divide-stone-100 overflow-y-auto dark:divide-stone-800">
        {notifications.length === 0 && <p className="py-8 text-center text-sm text-stone-400">No notifications yet.</p>}
        {notifications.map((n) => {
          const Icon = TYPE_ICON[n.type] || Info;
          return (
            <button
              key={n.id}
              onClick={() => !n.read && onRead(n.id)}
              className={`flex w-full items-start gap-3 px-1 py-3 text-left ${!n.read ? "bg-primary-50/50 dark:bg-primary-900/10" : ""}`}
            >
              <div className={`mt-0.5 rounded-full p-1.5 ${!n.read ? "bg-primary-100 text-primary-600 dark:bg-primary-900/40" : "bg-stone-100 text-stone-400 dark:bg-stone-800"}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${!n.read ? "font-semibold text-stone-900 dark:text-stone-50" : "text-stone-600 dark:text-stone-300"}`}>{n.title}</p>
                {n.body && <p className="truncate text-xs text-stone-400">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-stone-400">{timeAgo(n.created_at)}</p>
              </div>
              {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Desktop: click-away dropdown. Mobile: bottom sheet (consistent with the rest of the app's mobile patterns). */
export function NotificationsBell({ variant = "desktop" }) {
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (variant !== "desktop") return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [variant]);

  const bellButton = (
    <button
      onClick={() => setOpen((v) => !v)}
      className={variant === "desktop" ? "relative rounded-xl p-2.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" : "relative touch-target rounded-full p-2 text-stone-500"}
      aria-label="Notifications"
    >
      <Bell className={variant === "desktop" ? "h-5 w-5" : "h-5 w-5"} />
      {unreadCount > 0 && (
        <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );

  if (variant === "desktop") {
    return (
      <div className="relative" ref={ref}>
        {bellButton}
        {open && (
          <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-2xl border border-stone-200 bg-white p-3 shadow-xl dark:border-stone-800 dark:bg-stone-900">
            <NotificationList notifications={notifications} onRead={markNotificationRead} onReadAll={markAllNotificationsRead} />
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {bellButton}
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Notifications">
        <NotificationList notifications={notifications} onRead={markNotificationRead} onReadAll={markAllNotificationsRead} />
      </BottomSheet>
    </>
  );
}
