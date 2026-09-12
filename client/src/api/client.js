import axios from "axios";

// const client = axios.create({ baseURL: "/api" });
const client = axios.create({ 
  baseURL: "https://timber-storage-pro-production-fd55.up.railway.app/api" 
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("tsp_access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = null;

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && localStorage.getItem("tsp_refresh_token")) {
      original._retry = true;
      try {
        refreshing =
          refreshing ||
          axios.post("/api/auth/refresh", { refreshToken: localStorage.getItem("tsp_refresh_token") }).then((r) => {
            localStorage.setItem("tsp_access_token", r.data.data.accessToken);
            localStorage.setItem("tsp_refresh_token", r.data.data.refreshToken);
            refreshing = null;
            return r.data.data.accessToken;
          });
        const token = await refreshing;
        original.headers.Authorization = `Bearer ${token}`;
        return client(original);
      } catch {
        localStorage.removeItem("tsp_access_token");
        localStorage.removeItem("tsp_refresh_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

/** Unwraps { success, data } and throws a friendly message string on failure. */
async function call(promise) {
  try {
    const res = await promise;
    return res.data.data;
  } catch (e) {
    const msg = e.response?.data?.message || "Something went wrong. Please try again.";
    throw new Error(msg);
  }
}

export const api = {
  // setup (first-time only)
  setupStatus: () => call(client.get("/setup/status")),
  completeSetup: (data) => call(client.post("/setup", data)),

  // auth
  login: (username, password) => call(client.post("/auth/login", { username, password })),
  logout: () => call(client.post("/auth/logout")),
  me: () => call(client.get("/auth/me")),

  // dashboard
  dashboard: (warehouseId) => call(client.get("/dashboard", { params: { warehouse_id: warehouseId } })),

  // warehouses
  warehouses: () => call(client.get("/warehouses")),
  warehouse: (id) => call(client.get(`/warehouses/${id}`)),
  createWarehouse: (data) => call(client.post("/warehouses", data)),
  updateWarehouse: (id, data) => call(client.put(`/warehouses/${id}`, data)),
  deactivateWarehouse: (id) => call(client.delete(`/warehouses/${id}`)),

  // parties
  parties: (params) => call(client.get("/parties", { params })),
  party: (id) => call(client.get(`/parties/${id}`)),
  partyStatement: (id, params) => call(client.get(`/parties/${id}/statement`, { params })),
  createParty: (data) => call(client.post("/parties", data)),
  updateParty: (id, data) => call(client.put(`/parties/${id}`, data)),
  deleteParty: (id) => call(client.delete(`/parties/${id}`)),

  // containers
  containers: (params) => call(client.get("/containers", { params })),
  container: (id) => call(client.get(`/containers/${id}`)),
  createContainer: (data) => call(client.post("/containers", data)),
  updateContainer: (id, data) => call(client.put(`/containers/${id}`, data)),
  clearContainer: (id) => call(client.post(`/containers/${id}/clear`)),
  deleteContainer: (id) => call(client.delete(`/containers/${id}`)),

  // loading
  loadingLogs: (params) => call(client.get("/loading", { params })),
  recordLoading: (data) => call(client.post("/loading", data)),
  updateLoadingLog: (id, data) => call(client.put(`/loading/${id}`, data)),
  deleteLoadingLog: (id) => call(client.delete(`/loading/${id}`)),

  // invoices
  eligibleContainers: (partyId, warehouseId) =>
    call(client.get("/invoices/eligible-containers", { params: { party_id: partyId, warehouse_id: warehouseId } })),
  invoices: (params) => call(client.get("/invoices", { params })),
  invoice: (id) => call(client.get(`/invoices/${id}`)),
  generateInvoice: (data) => call(client.post("/invoices", data)),
  updateInvoice: (id, data) => call(client.put(`/invoices/${id}`, data)),
  cancelInvoice: (id) => call(client.post(`/invoices/${id}/cancel`)),
  adjustInvoice: (id, data) => call(client.post(`/invoices/${id}/adjust`, data)),
  deleteInvoice: (id) => call(client.delete(`/invoices/${id}`)),

  // payments
  payments: (params) => call(client.get("/payments", { params })),
  recordPayment: (data) => call(client.post("/payments", data)),
  deletePayment: (id) => call(client.delete(`/payments/${id}`)),

  // reports
  storageReport: (params) => call(client.get("/reports/storage", { params })),
  loadingReport: (params) => call(client.get("/reports/loading", { params })),
  rentReport: (params) => call(client.get("/reports/rent", { params })),
  warehousePerformance: () => call(client.get("/reports/warehouse-performance")),

  // users
  users: () => call(client.get("/users")),
  createUser: (data) => call(client.post("/users", data)),
  updateUser: (id, data) => call(client.put(`/users/${id}`, data)),
  resetPassword: (id, password) => call(client.post(`/users/${id}/reset-password`, { password })),

  // audit logs
  auditLogs: (params) => call(client.get("/audit-logs", { params })),

  // settings
  settings: () => call(client.get("/settings")),
  updateSettings: (data) => call(client.put("/settings", data)),

  // notifications
  notifications: () => call(client.get("/notifications")),
  markNotificationRead: (id) => call(client.post(`/notifications/${id}/read`)),
  markAllNotificationsRead: () => call(client.post("/notifications/read-all")),

  // party portal (admin management)
  partyPortalList: () => call(client.get("/party-portal")),
  generatePartyPortalAccess: (partyId) => call(client.post(`/party-portal/${partyId}/generate`)),
  revokePartyPortalAccess: (partyId) => call(client.post(`/party-portal/${partyId}/revoke`)),

  // party portal (party-facing — uses a separate portal token, not the admin one)
  portalLogin: (username, password) => call(client.post("/party-portal/login", { username, password })),
  portalVerify: (token) => call(client.get(`/party-portal/verify/${token}`)),
};

/**
 * Deliberately a separate axios instance from `client` above — the party
 * portal uses its own short-lived token issued by a completely different
 * auth path, and must never pick up (or be affected by) the main app's
 * admin token / refresh-token interceptor logic.
 */
const portalClient = axios.create({ baseURL: "/api" });
export const portalApi = {
  me: (token) => call(portalClient.get("/party-portal/me", { headers: { Authorization: `Bearer ${token}` } })),
};

export default client;
