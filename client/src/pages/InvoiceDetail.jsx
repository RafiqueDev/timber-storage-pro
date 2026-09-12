import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Printer, Wallet, XCircle, Share2, ReceiptText, Pencil, MoreVertical, Undo2, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import { useApp } from "../context/AppContext.jsx";
import { downloadInvoicePdf, generateInvoicePdf } from "../lib/pdf.js";
import { printSection } from "../lib/print.js";
import {
  Card,
  Badge,
  Button,
  Modal,
  BottomSheet,
  Input,
  Select,
  Textarea,
  ConfirmDialog,
  useConfirm,
  formatCurrency,
  formatDate,
  ErrorState,
  Skeleton,
  PrintHeaderFooter,
} from "../components/ui.jsx";

const STATUS_TONE = {
  Draft: "neutral",
  Generated: "info",
  "Partially Paid": "warning",
  Paid: "success",
  Cancelled: "danger",
};

function round2Safe(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { pushToast, setBreadcrumbExtra, companyName, developerName } = useApp();
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", payment_date: new Date().toISOString().slice(0, 10), payment_method: "Cash", reference: "", notes: "" });
  const [payError, setPayError] = useState("");
  const [saving, setSaving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ amount: "", reason: "" });
  const [adjustError, setAdjustError] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [editDate, setEditDate] = useState("");
  const [editError, setEditError] = useState("");
  const [editing, setEditing] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { confirmState, confirm, close } = useConfirm();

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && !!navigator.share && !!navigator.canShare);
  }, []);

  const load = async () => {
    setError("");
    try {
      const inv = await api.invoice(id);
      setInvoice(inv);
      setBreadcrumbExtra(inv.invoice_number);
      setPayForm((f) => ({ ...f, amount: inv.balance > 0 ? String(inv.balance) : "" }));
      setAdjustForm({ amount: "", reason: "" });
      setEditDate(inv.invoice_date);
      setEditItems(inv.items.map((i) => ({ ...i })));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    return () => setBreadcrumbExtra(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const submitPayment = async (e) => {
    e.preventDefault();
    setPayError("");
    const amt = +payForm.amount;
    if (!(amt > 0)) return setPayError("Please enter a valid payment amount.");
    if (amt > invoice.balance + 0.01) return setPayError(`Payment cannot exceed the remaining balance (${formatCurrency(invoice.balance)}).`);
    setSaving(true);
    try {
      await api.recordPayment({ invoice_id: id, ...payForm, amount: amt });
      pushToast("Payment recorded successfully.");
      setPayOpen(false);
      load();
    } catch (e2) {
      setPayError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const submitAdjustment = async (e) => {
    e.preventDefault();
    setAdjustError("");
    const amt = +adjustForm.amount;
    if (!(amt > 0)) return setAdjustError("Please enter a valid adjustment amount.");
    if (amt > invoice.subtotal + 0.01) return setAdjustError(`Adjustment cannot exceed the original invoice total (${formatCurrency(invoice.subtotal)}).`);
    if (!adjustForm.reason.trim()) return setAdjustError("Please provide a reason for this adjustment.");
    setAdjusting(true);
    try {
      await api.adjustInvoice(id, adjustForm);
      pushToast("Adjustment issued as a credit note.");
      setAdjustOpen(false);
      load();
    } catch (e2) {
      setAdjustError(e2.message);
    } finally {
      setAdjusting(false);
    }
  };

  function calcItemRent(item, days) {
    if (days < 0) return 0;
    if (item.rent_type === "Daily") return Math.round(days * item.rent_rate * 100) / 100;
    return Math.round(((item.rent_rate / 30) * days) * 100) / 100;
  }

  const editTotal = editItems.reduce((sum, i) => sum + calcItemRent(i, +i.billable_days || 0), 0);

  const submitEdit = async (e) => {
    e.preventDefault();
    setEditError("");
    if (editItems.some((i) => !(+i.billable_days >= 0))) return setEditError("Billable days cannot be negative.");
    setEditing(true);
    try {
      await api.updateInvoice(id, {
        invoice_date: editDate,
        items: editItems.map((i) => ({ id: i.id, billable_days: +i.billable_days })),
      });
      pushToast("Invoice updated successfully.");
      setEditOpen(false);
      load();
    } catch (e2) {
      setEditError(e2.message);
    } finally {
      setEditing(false);
    }
  };

  const handleCancel = () => {
    confirm({
      title: "Cancel invoice",
      description: `Cancel invoice ${invoice.invoice_number}? This action is audited and cannot be reversed from here.`,
      confirmLabel: "Cancel Invoice",
      onConfirm: async () => {
        try {
          await api.cancelInvoice(id);
          pushToast("Invoice cancelled.");
          close();
          load();
        } catch (e2) {
          pushToast(e2.message, "error");
          close();
        }
      },
    });
  };

  const handleUndoInvoice = () => {
    confirm({
      title: isCreditNote ? "Undo adjustment" : "Undo invoice",
      description: isCreditNote
        ? `Permanently remove this credit note? This can only be done because none of it has been applied to a bill yet.`
        : `Permanently remove ${invoice.invoice_number}? This can only be done because it has no payments and no adjustment issued against it.`,
      confirmLabel: "Undo",
      onConfirm: async () => {
        try {
          await api.deleteInvoice(id);
          pushToast(isCreditNote ? "Adjustment undone." : "Invoice undone.");
          close();
          navigate(isCreditNote ? -1 : "/invoices");
        } catch (e2) {
          pushToast(e2.message, "error");
          close();
        }
      },
    });
  };

  const handleUndoPayment = (payment) => {
    confirm({
      title: "Undo payment",
      description:
        payment.payment_method === "Credit Note"
          ? `Undo this ${formatCurrency(payment.amount)} auto-applied credit? It will be refunded back to the original credit note for future use.`
          : `Undo this ${formatCurrency(payment.amount)} payment recorded on ${formatDate(payment.payment_date)}?`,
      confirmLabel: "Undo Payment",
      onConfirm: async () => {
        try {
          await api.deletePayment(payment.id);
          pushToast("Payment undone.");
          close();
          load();
        } catch (e2) {
          pushToast(e2.message, "error");
          close();
        }
      },
    });
  };

  const handleShare = async () => {
    try {
      const { doc, filename } = generateInvoicePdf(invoice);
      const blob = doc.output("blob");
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: invoice.invoice_number, text: `Invoice ${invoice.invoice_number}` });
      } else {
        downloadInvoicePdf(invoice);
      }
    } catch (e) {
      if (e?.name !== "AbortError") pushToast("Couldn't open the share sheet — downloaded instead.", "error");
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!invoice) return <Skeleton className="h-96" />;

  const isCreditNote = invoice.type === "CreditNote";
  const canUndo = isCreditNote
    ? round2Safe(invoice.credit_remaining) === round2Safe(Math.abs(invoice.subtotal))
    : invoice.editable && (!invoice.adjustments || invoice.adjustments.length === 0);

  return (
    <div className="space-y-5">
      {/* MOBILE ACTION BAR: Back + a compact "More" menu, plus a prominent
          full-width Record Payment button when there's a balance due — this
          replaces a long wrapping row of labeled buttons that used to spill
          over and crowd the bottom nav on narrow screens. */}
      <div className="no-print flex items-center justify-between lg:hidden">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-700">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button
          onClick={() => setMoreOpen(true)}
          className="touch-target flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-sm font-medium text-stone-600 dark:border-stone-700 dark:text-stone-300"
        >
          <MoreVertical className="h-4 w-4" /> More
        </button>
      </div>
      {!isCreditNote && invoice.status !== "Cancelled" && invoice.balance > 0 && (
        <Button className="no-print w-full lg:hidden" onClick={() => setPayOpen(true)}>
          <Wallet className="h-4 w-4" /> Record Payment
        </Button>
      )}

      {/* DESKTOP ACTION BAR: unchanged inline row of labeled buttons. */}
      <div className="no-print hidden items-center justify-between lg:flex">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-700">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex flex-wrap gap-2">
          {invoice.editable && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit Invoice
            </Button>
          )}
          {!isCreditNote && invoice.status !== "Cancelled" && invoice.balance > 0 && (
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <Wallet className="h-4 w-4" /> Record Payment
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => printSection("invoice-print-area")}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadInvoicePdf(invoice)}>
            <Download className="h-4 w-4" /> PDF
          </Button>
          {canShare && (
            <Button size="sm" variant="outline" onClick={handleShare}>
              <Share2 className="h-4 w-4" /> Share
            </Button>
          )}
          {!isCreditNote && invoice.status !== "Cancelled" && (
            <Button size="sm" variant="ghost" onClick={() => setAdjustOpen(true)}>
              <ReceiptText className="h-4 w-4" /> Issue Adjustment
            </Button>
          )}
          {!isCreditNote && invoice.status !== "Cancelled" && invoice.paid_amount === 0 && (
            <Button size="sm" variant="ghost" onClick={handleCancel}>
              <XCircle className="h-4 w-4" /> Cancel Invoice
            </Button>
          )}
          {canUndo && (
            <Button size="sm" variant="ghost" onClick={handleUndoInvoice}>
              <Undo2 className="h-4 w-4" /> Undo
            </Button>
          )}
        </div>
      </div>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Invoice Actions">
        <div className="space-y-1.5">
          {invoice.editable && (
            <SheetAction
              icon={Pencil}
              label="Edit Invoice"
              onClick={() => {
                setMoreOpen(false);
                setEditOpen(true);
              }}
            />
          )}
          <SheetAction
            icon={Printer}
            label="Print"
            onClick={() => {
              setMoreOpen(false);
              printSection("invoice-print-area");
            }}
          />
          <SheetAction
            icon={Download}
            label="Download PDF"
            onClick={() => {
              setMoreOpen(false);
              downloadInvoicePdf(invoice);
            }}
          />
          {canShare && (
            <SheetAction
              icon={Share2}
              label="Share"
              onClick={() => {
                setMoreOpen(false);
                handleShare();
              }}
            />
          )}
          {!isCreditNote && invoice.status !== "Cancelled" && (
            <SheetAction
              icon={ReceiptText}
              label="Issue Adjustment"
              onClick={() => {
                setMoreOpen(false);
                setAdjustOpen(true);
              }}
            />
          )}
          {!isCreditNote && invoice.status !== "Cancelled" && invoice.paid_amount === 0 && (
            <SheetAction
              icon={XCircle}
              label="Cancel Invoice"
              danger
              onClick={() => {
                setMoreOpen(false);
                handleCancel();
              }}
            />
          )}
          {canUndo && (
            <SheetAction
              icon={Undo2}
              label="Undo"
              danger
              onClick={() => {
                setMoreOpen(false);
                handleUndoInvoice();
              }}
            />
          )}
        </div>
      </BottomSheet>

      <div id="invoice-print-area">
        <PrintHeaderFooter companyName={companyName} developerName={developerName} />
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 dark:border-stone-800 pb-4">
            <div>
              <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">
                {invoice.invoice_number} {isCreditNote && <Badge tone="danger">Credit Note</Badge>}
              </h2>
              <p className="text-sm text-stone-500">{invoice.warehouse?.branch_name}</p>
            </div>
            <Badge tone={STATUS_TONE[invoice.status] || "neutral"}>{invoice.status}</Badge>
          </div>

          {isCreditNote && (
            <div className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              This is a banked credit — Reason: {invoice.adjustment_reason}. {invoice.credit_remaining > 0
                ? `${formatCurrency(invoice.credit_remaining)} is still available and will apply automatically to this party's next bill.`
                : "It has been fully applied to a later bill already."}
            </div>
          )}

          <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Info label="Party" value={invoice.party?.party_name} />
            <Info label="Invoice Date" value={formatDate(invoice.invoice_date)} />
            <Info label="Billing Period" value={`${formatDate(invoice.billing_period_start)} → ${formatDate(invoice.billing_period_end)}`} />
            <Info label="Created" value={new Date(invoice.created_at).toLocaleDateString()} />
          </div>

          {invoice.items.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 dark:bg-stone-900 text-left text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-3 py-2">Container</th>
                    <th className="px-3 py-2">Arrival</th>
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2">Days</th>
                    <th className="px-3 py-2">Basis</th>
                    <th className="px-3 py-2">Rate</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {invoice.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2 font-medium text-stone-800 dark:text-stone-100">{i.container_number}</td>
                      <td className="px-3 py-2 text-stone-500">{formatDate(i.arrival_date)}</td>
                      <td className="px-3 py-2 text-stone-500">
                        {formatDate(i.billing_start)} → {formatDate(i.billing_end)}
                      </td>
                      <td className="px-3 py-2 text-stone-500">{i.billable_days}</td>
                      <td className="px-3 py-2 text-stone-500">{i.rent_type}</td>
                      <td className="px-3 py-2 text-stone-500">{formatCurrency(i.rent_rate)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-stone-800 dark:text-stone-100">{formatCurrency(i.calculated_rent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-stone-500">Subtotal</span>
              <span className="font-medium text-stone-800 dark:text-stone-100">{formatCurrency(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-500">Paid</span>
              <span className="font-medium text-forest-600">{formatCurrency(invoice.paid_amount)}</span>
            </div>
            <div className="flex justify-between border-t border-stone-100 dark:border-stone-800 pt-1.5 text-base font-bold">
              <span>Balance</span>
              <span className="text-primary-600">{formatCurrency(invoice.balance)}</span>
            </div>
          </div>
        </Card>

        {!isCreditNote && (
          <Card className="mt-5 p-5">
            <h3 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-200">Payments</h3>
            {invoice.payments.length === 0 && <p className="text-sm text-stone-400">No payments recorded yet.</p>}
            <div className="divide-y divide-stone-100 dark:divide-stone-800">
              {invoice.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-stone-800 dark:text-stone-100">
                      {p.payment_method}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </p>
                    <p className="text-xs text-stone-400">{formatDate(p.payment_date)}</p>
                  </div>
                  <div className="no-print flex items-center gap-2">
                    <span className="font-semibold text-forest-600">{formatCurrency(p.amount)}</span>
                    <button
                      onClick={() => handleUndoPayment(p)}
                      className="touch-target rounded-lg p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                      aria-label="Undo payment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {!isCreditNote && invoice.adjustments?.length > 0 && (
          <Card className="mt-5 p-5">
            <h3 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-200">Adjustments / Banked Credit</h3>
            <p className="mb-3 text-xs text-stone-400">
              These don't reduce this invoice's own balance — each one sits as available credit and applies automatically the
              next time this party is billed.
            </p>
            <div className="divide-y divide-stone-100 dark:divide-stone-800">
              {invoice.adjustments.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-stone-800 dark:text-stone-100">{a.invoice_number}</p>
                    <p className="text-xs text-stone-400">{a.adjustment_reason}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-red-600">{formatCurrency(Math.abs(a.subtotal))}</span>
                    <p className="text-xs text-stone-400">
                      {a.credit_remaining > 0 ? `${formatCurrency(a.credit_remaining)} still available` : "Fully applied"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record Payment">
        <form onSubmit={submitPayment} className="space-y-4">
          {payError && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{payError}</div>}
          <div className="rounded-xl bg-stone-100 dark:bg-stone-800 px-4 py-3 text-sm">
            Invoice Total: <span className="font-semibold">{formatCurrency(invoice.subtotal)}</span> · Remaining:{" "}
            <span className="font-semibold text-primary-600">{formatCurrency(invoice.balance)}</span>
          </div>
          <Input label="Amount" required type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
          <Select label="Payment Method" value={payForm.payment_method} onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}>
            <option value="Cash">Cash</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Other">Other</option>
          </Select>
          <Input label="Payment Date" required type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
          <Input label="Reference" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="TRX-1234" />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Record Payment
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit Invoice — ${invoice.invoice_number}`} size="lg">
        <form onSubmit={submitEdit} className="space-y-4">
          {editError && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{editError}</div>}
          <p className="text-sm text-stone-500">
            This invoice hasn't been paid yet, so its billable days can still be corrected directly. Once a payment is recorded, use
            "Issue Adjustment" instead.
          </p>
          <Input label="Invoice Date" required type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
          <div className="space-y-3">
            {editItems.map((item, idx) => (
              <div key={item.id} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-stone-800 dark:text-stone-100">{item.container_number}</p>
                  <span className="text-xs text-stone-400">
                    {item.rent_type} — {formatCurrency(item.rent_rate)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-400">Billable Days</span>
                    <Input
                      type="number"
                      min="0"
                      value={item.billable_days}
                      onChange={(e) => {
                        const next = [...editItems];
                        next[idx] = { ...next[idx], billable_days: e.target.value };
                        setEditItems(next);
                      }}
                      className="!w-24 !py-1.5"
                    />
                  </div>
                  <span className="text-sm font-semibold text-primary-600">{formatCurrency(calcItemRent(item, +item.billable_days || 0))}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-stone-100 px-4 py-3 text-sm font-bold dark:bg-stone-800">
            <div className="flex justify-between">
              <span>New Total</span>
              <span className="text-primary-600">{formatCurrency(editTotal)}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={editing}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Issue Adjustment">
        <form onSubmit={submitAdjustment} className="space-y-4">
          {adjustError && <div className="rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">{adjustError}</div>}
          <p className="text-sm text-stone-500">
            This issues a linked credit note instead of editing {invoice.invoice_number}'s original numbers — the original stays exactly
            as generated, and the credit note reduces the party's outstanding balance.
          </p>
          <Input
            label="Adjustment Amount"
            required
            type="number"
            min="0.01"
            step="0.01"
            max={invoice.subtotal}
            value={adjustForm.amount}
            onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })}
          />
          <Textarea label="Reason" required rows={3} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} placeholder="e.g. Agreed discount for delayed dispatch" />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={adjusting}>
              Issue Credit Note
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmState.open}
        onClose={close}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        danger={confirmState.danger}
      />
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-stone-400">{label}</p>
      <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">{value}</p>
    </div>
  );
}

function SheetAction({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium touch-target ${
        danger ? "text-red-600" : "text-stone-700 dark:text-stone-200"
      } hover:bg-stone-100 dark:hover:bg-stone-800`}
    >
      <Icon className="h-4.5 w-4.5" />
      {label}
    </button>
  );
}
