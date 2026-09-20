import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [activeWarehouseId, setActiveWarehouseId] = useState(localStorage.getItem("tsp_active_warehouse") || "all");
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState(localStorage.getItem("tsp_theme") || "light");
  const [toasts, setToasts] = useState([]);
  const [company, setCompany] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [breadcrumbExtra, setBreadcrumbExtra] = useState(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("tsp_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("tsp_active_warehouse", activeWarehouseId);
  }, [activeWarehouseId]);

  const loadCompany = useCallback(async () => {
    try {
      setCompany(await api.settings());
    } catch {
      /* not fatal — print headers/footers just fall back to defaults */
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await api.notifications();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      /* ignore transient failures */
    }
  }, []);

  const bootstrap = useCallback(async () => {
    if (!localStorage.getItem("tsp_access_token")) {
      setAuthLoading(false);
      return;
    }
    try {
      const data = await api.me();
      setUser(data.user);
      setWarehouses(data.warehouses);
      if (data.warehouses.length === 1 && activeWarehouseId === "all") {
        setActiveWarehouseId(data.warehouses[0].id);
      }
      loadCompany();
      loadNotifications();
    } catch {
      localStorage.removeItem("tsp_access_token");
      localStorage.removeItem("tsp_refresh_token");
    } finally {
      setAuthLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Light polling so the notification bell stays reasonably fresh without
  // needing websockets for a warehouse-floor app.
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, [user, loadNotifications]);

  const login = async (username, password) => {
    const data = await api.login(username, password);
    localStorage.setItem("tsp_access_token", data.accessToken);
    localStorage.setItem("tsp_refresh_token", data.refreshToken);
    setUser(data.user);
    setWarehouses(data.warehouses);
    setActiveWarehouseId(data.warehouses.length === 1 ? data.warehouses[0].id : "all");
    loadCompany();
    loadNotifications();
    return data.user;
  };

  /** Multi-tenant sign-up: creates a brand new company + admin account and
   * logs straight in, same shape of side effects as login() above. Can be
   * called at any time — unlike the old single-tenant version, this is
   * never gated behind "has anyone signed up yet". */
  const completeSetup = async (payload) => {
    const data = await api.completeSetup(payload);
    localStorage.setItem("tsp_access_token", data.accessToken);
    localStorage.setItem("tsp_refresh_token", data.refreshToken);
    setUser(data.user);
    setWarehouses(data.warehouses);
    setActiveWarehouseId("all");
    loadCompany();
    loadNotifications();
    return data.user;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    localStorage.removeItem("tsp_access_token");
    localStorage.removeItem("tsp_refresh_token");
    setUser(null);
    setWarehouses([]);
    setNotifications([]);
    setUnreadCount(0);
  };

  const markNotificationRead = async (id) => {
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.markNotificationRead(id);
    } catch {
      /* best-effort */
    }
  };

  const markAllNotificationsRead = async () => {
    setNotifications((ns) => ns.map((n) => ({ ...n, read: 1 })));
    setUnreadCount(0);
    try {
      await api.markAllNotificationsRead();
    } catch {
      /* best-effort */
    }
  };

  const pushToast = useCallback((message, variant = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, variant }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const activeWarehouse = warehouses.find((w) => w.id === activeWarehouseId) || null;
  const isAdmin = user?.role === "SUPER_ADMIN";
  const companyName = company?.name || "Timber Storage Pro";
  const developerName = company?.developer_name || "Timber Storage Pro Dev Team";

  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        warehouses,
        setWarehouses,
        activeWarehouseId,
        setActiveWarehouseId,
        activeWarehouse,
        isAdmin,
        authLoading,
        login,
        completeSetup,
        logout,
        theme,
        setTheme,
        toasts,
        pushToast,
        company,
        setCompany,
        companyName,
        developerName,
        loadCompany,
        notifications,
        unreadCount,
        loadNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        breadcrumbExtra,
        setBreadcrumbExtra,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
