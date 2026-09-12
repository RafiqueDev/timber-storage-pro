import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, PackageCheck, Truck, Wallet, Receipt, CheckCircle2, PlusCircle, FileBarChart } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { StatCard, CardSkeletonGrid, Card, Button, formatCurrency, ErrorState } from "../components/ui.jsx";

export default function Dashboard() {
  const { activeWarehouseId, activeWarehouse, pushToast } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.dashboard(activeWarehouseId);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWarehouseId]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
          Viewing: {activeWarehouseId === "all" ? "All Warehouses" : activeWarehouse?.branch_name}
        </p>
        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Dashboard</h2>
      </div>

      {loading && <CardSkeletonGrid count={8} />}
      {error && <ErrorState message={error} onRetry={load} />}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Active Containers" value={data.activeContainers} icon={Boxes} tone="primary" />
            <StatCard label="Stored Bundles" value={data.totalStoredBundles.toLocaleString()} icon={PackageCheck} tone="forest" />
            <StatCard label="Loaded Bundles" value={data.totalLoadedBundles.toLocaleString()} icon={Truck} tone="primary" />
            <StatCard label="Remaining Bundles" value={data.remainingBundles.toLocaleString()} icon={Boxes} tone="forest" />
            <StatCard label="Today's Loading" value={data.todaysLoading.toLocaleString()} icon={Truck} tone="amber" />
            <StatCard label="Accrued Rent" value={formatCurrency(data.accruedRent)} icon={Wallet} tone="primary" />
            <StatCard label="Outstanding Bills" value={formatCurrency(data.outstandingBills)} icon={Receipt} tone="red" />
            <StatCard label="Cleared Containers" value={data.clearedContainers} icon={CheckCircle2} tone="forest" />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">Quick Actions</p>
            <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap">
              <Button variant="secondary" className="justify-start" onClick={() => navigate("/containers")}>
                <PlusCircle className="h-4 w-4" /> Add Container
              </Button>
              <Button variant="secondary" className="justify-start" onClick={() => navigate("/loading")}>
                <Truck className="h-4 w-4" /> Record Loading
              </Button>
              <Button variant="secondary" className="justify-start" onClick={() => navigate("/billing")}>
                <Receipt className="h-4 w-4" /> Generate Bill
              </Button>
              <Button variant="secondary" className="justify-start" onClick={() => navigate("/reports")}>
                <FileBarChart className="h-4 w-4" /> View Reports
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">Recent Activity</p>
            <Card className="divide-y divide-stone-100 dark:divide-stone-800">
              {data.recentActivity.length === 0 && <p className="p-4 text-sm text-stone-400">No recent activity yet.</p>}
              {data.recentActivity.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{a.action}</p>
                    <p className="text-xs text-stone-400">{a.user_name}</p>
                  </div>
                  <span className="shrink-0 text-xs text-stone-400">{new Date(a.created_at).toLocaleString()}</span>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
