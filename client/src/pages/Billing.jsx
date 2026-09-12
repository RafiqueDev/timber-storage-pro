import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Receipt, Download, Share2, PackageCheck, Boxes, AlertCircle, CheckCircle2 } from "lucide-react";
import { api } from "../api/client.js";
import { useApp } from "../context/AppContext.jsx";
import { downloadInvoicePdf, generateInvoicePdf } from "../lib/pdf.js";
import { Card, Badge, Button, Select, Input, EmptyState, formatCurrency, formatDate } from "../components/ui.jsx";

function calcRent(rentType, rentRate, days) {
  if (days < 0) return 0;
  if (rentType === "Daily") return Math.round(days * rentRate * 100) / 100;
  return Math.round((rentRate / 30) * days * 100) / 100;
}

const MODES = [
  { key: "exact", label: "Exact Days" },
  { key: "round_down_months", label: "Round Down to Months" },
  { key: "round_up_months", label: "Round Up to Next Month" },
];

/** Given the backend's exact-day breakdown, resolve the day count for a mode. */
function daysForMode(container, mode) {
  const { months, remainingDays } = container.exactBreakdown;
  if (mode === "round_down_months") return months * 30;
  if (mode === "round_up_months") return remainingDays > 0 ? (months + 1) * 30 : months * 30;
  return container.defaultDays;
}

export default function Billing() {
  const { warehouses, activeWarehouseId, pushToast } = useApp();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [parties, setParties] = useState([]);
  const [partyId, setPartyId] = useState(searchParams.get("party") || "");
  const [warehouseId, setWarehouseId] = useState(searchParams.get("warehouse") || (activeWarehouseId !== "all" ? activeWarehouseId : ""));
  const [eligible, setEligible] = useState([]);
  const [selected, setSelected] = useState({}); // containerId -> { checked, days, mode }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generatedInvoice, setGeneratedInvoice] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [availableCredit, setAvailableCredit] = useState(0);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && !!navigator.share && !!navigator.canShare);
  }, []);

  useEffect(() => {
    api.parties().then(setParties).catch(() => {});
  }, []);

  useEffect(() => {
    if (!partyId) {
      setAvailableCredit(0);
      return;
    }
    api
      .party(partyId)
      .then((p) => setAvailableCredit(p.availableCredit || 0))
      .catch(() => setAvailableCredit(0));
  }, [partyId]);

  useEffect(() => {
    if (!partyId) {
      setEligible([]);
      return;
    }
    setLoading(true);
    setError("");
    api
      .eligibleContainers(partyId, warehouseId || undefined)
      .then((rows) => {
        setEligible(rows);
        const sel = {};
        rows.forEach((r) => (sel[r.id] = { checked: false, days: r.defaultDays, mode: "exact" }));
        setSelected(sel);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [partyId, warehouseId]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: { ...s[id], checked: !s[id].checked } }));
  const setDays = (id, val) => setSelected((s) => ({ ...s, [id]: { ...s[id], days: val } }));
  const setMode = (container, mode) =>
    setSelected((s) => ({ ...s, [container.id]: { ...s[container.id], mode, days: daysForMode(container, mode) } }));

  const selectedLines = useMemo(
    () => eligible.filter((c) => selected[c.id]?.checked).map((c) => ({ container: c, days: +selected[c.id].days || 0 })),
    [eligible, selected]
  );

  const total = selectedLines.reduce((sum, l) => sum + calcRent(l.container.rent_type, l.container.rent_rate, l.days), 0);

  const party = parties.find((p) => p.id === partyId);

  const generate = async () => {
    if (selectedLines.length === 0) return pushToast("Select at least one container to bill.", "error");
    setGenerating(true);
    try {
      const inv = await api.generateInvoice({
        party_id: partyId,
        warehouse_id: warehouseId || selectedLines[0].container.warehouse_id,
        lines: selectedLines.map((l) => ({ container_id: l.container.id, billable_days: l.days })),
      });
      setGeneratedInvoice(inv);
      pushToast("Invoice generated successfully.");
    } catch (e) {
      pushToast(e.message, "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleShare = async () => {
    try {
      const { doc, filename } = generateInvoicePdf(generatedInvoice);
      const blob = doc.output("blob");
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: generatedInvoice.invoice_number });
      } else {
        downloadInvoicePdf(generatedInvoice);
      }
    } catch (e) {
      if (e?.name !== "AbortError") pushToast("Couldn't open the share sheet — downloaded instead.", "error");
    }
  };

  if (generatedInvoice) {
    return (
      <div className="space-y-5">
        <Card className="p-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-forest-500/10">
            <Receipt className="h-7 w-7 text-forest-600" />
          </div>
          <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">Invoice generated successfully.</h2>
          <p className="text-sm text-stone-500">{generatedInvoice.invoice_number}</p>
          <p className="mt-2 text-2xl font-bold text-primary-600">{formatCurrency(generatedInvoice.subtotal)}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => downloadInvoicePdf(generatedInvoice)}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
            {canShare && (
              <Button variant="outline" onClick={handleShare}>
                <Share2 className="h-4 w-4" /> Share
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate(`/invoices/${generatedInvoice.id}`)}>
              View Invoice
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setGeneratedInvoice(null);
                setPartyId("");
                setEligible([]);
              }}
            >
              Bill Another Party
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Generate Bill</h2>

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Party" required value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">Select party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.party_name}
              </option>
            ))}
          </Select>
          <Select label="Warehouse (optional filter)" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.branch_name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {!partyId && <EmptyState title="Select a party to see eligible containers." />}
      {partyId && loading && <p className="text-sm text-stone-400">Loading eligible containers...</p>}
      {partyId && error && <p className="text-sm text-red-500">{error}</p>}
      {partyId && availableCredit > 0 && (
        <Card className="border-forest-500/30 bg-forest-500/5 p-4">
          <p className="text-sm font-medium text-forest-700 dark:text-forest-400">
            {party?.party_name} has {formatCurrency(availableCredit)} in banked credit from a prior adjustment — it will
            automatically apply to whatever invoice you generate below.
          </p>
        </Card>
      )}
      {partyId && !loading && eligible.length === 0 && <EmptyState title="No eligible containers for this party." description="Containers appear here as soon as they're active or fully cleared, so a finished container's final period can still be billed." />}

      {eligible.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-200">{party?.party_name} — Eligible Containers</h3>
          <div className="space-y-3">
            {eligible.map((c) => {
              const sel = selected[c.id] || {};
              const { months, remainingDays } = c.exactBreakdown;
              const cardTone = c.billedUnpaid
                ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
                : c.billedAndCleared
                ? "border-forest-500/40 bg-forest-500/5"
                : c.status === "Cleared"
                ? "border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-800/30"
                : "border-stone-200 dark:border-stone-800";
              return (
                <div key={c.id} className={`rounded-xl border p-3 ${cardTone}`}>
                  <label className={`flex items-start gap-3 ${c.alreadyBilled ? "cursor-not-allowed opacity-90" : ""}`}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 rounded"
                      checked={!!sel.checked}
                      disabled={c.alreadyBilled}
                      onChange={() => toggle(c.id)}
                    />
                    <div className="flex-1">
                      <p className="font-medium text-stone-800 dark:text-stone-100">{c.container_number}</p>
                      <p className="mt-0.5 text-xs text-stone-400">
                        Since {formatDate(c.periodStart)} · {c.rent_type} — {formatCurrency(c.rent_rate)}
                        {c.status === "Cleared" && ` · Cleared on ${formatDate(c.referenceEnd)}`}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.status === "Cleared" && (
                          <Badge tone="neutral">
                            <PackageCheck className="mr-1 inline h-3 w-3" /> Cleared
                          </Badge>
                        )}
                        <Badge tone="info">
                          <Boxes className="mr-1 inline h-3 w-3" /> {c.remainingBundles} bundles remaining
                        </Badge>
                        {c.billedUnpaid && (
                          <Badge tone="danger">
                            <AlertCircle className="mr-1 inline h-3 w-3" /> Already billed — {formatCurrency(c.lastInvoiceBalance)} outstanding
                          </Badge>
                        )}
                        {c.billedAndCleared && (
                          <Badge tone="success">
                            <CheckCircle2 className="mr-1 inline h-3 w-3" /> Billed & payment cleared
                          </Badge>
                        )}
                      </div>
                      {c.alreadyBilled && (
                        <p className="mt-1.5 text-xs text-stone-400">
                          Nothing new to bill yet on {c.lastInvoiceNumber} — you can still view it, but it can't be billed again until
                          more time accrues.
                        </p>
                      )}
                    </div>
                  </label>
                  {sel.checked && !c.alreadyBilled && (
                    <div className="mt-3 space-y-3 pl-8">
                      <div className="flex flex-wrap gap-2">
                        {MODES.map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => setMode(c, m.key)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              sel.mode === m.key
                                ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                                : "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-stone-400">
                        {c.defaultDays} days accrued = {months} month{months !== 1 ? "s" : ""}, {remainingDays} day{remainingDays !== 1 ? "s" : ""}. Adjust the exact
                        number billed below if needed.
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-stone-400">Billable Days</span>
                          <Input type="number" min="0" value={sel.days} onChange={(e) => setDays(c.id, e.target.value)} className="!w-24 !py-1.5" />
                        </div>
                        <span className="text-sm font-semibold text-primary-600">{formatCurrency(calcRent(c.rent_type, c.rent_rate, +sel.days || 0))}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selectedLines.length > 0 && (
            <div className="mt-5 rounded-xl bg-stone-100 dark:bg-stone-800 p-4">
              <div className="flex items-center justify-between text-sm font-bold text-stone-800 dark:text-stone-100">
                <span>Live Total</span>
                <span className="text-lg text-primary-600">{formatCurrency(total)}</span>
              </div>
              {availableCredit > 0 && (
                <div className="mt-1.5 flex items-center justify-between text-xs text-forest-600">
                  <span>Banked credit applied automatically</span>
                  <span>-{formatCurrency(Math.min(availableCredit, total))}</span>
                </div>
              )}
            </div>
          )}

          <Button className="mt-4 w-full sm:w-auto" disabled={selectedLines.length === 0} loading={generating} onClick={generate}>
            <Receipt className="h-4 w-4" /> Review & Generate PDF
          </Button>
        </Card>
      )}
    </div>
  );
}
