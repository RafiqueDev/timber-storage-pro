import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency, formatDate } from "../components/ui.jsx";

function sanitizeFilename(name) {
  return String(name).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
}

/**
 * A5 Landscape invoice PDF (spec #38-#40).
 */
export function generateInvoicePdf(invoice) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a5" });
  const symbol = invoice.company?.currency_symbol || "Rs.";
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text(invoice.company?.name || "Timber Storage Pro", margin, 14);
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.text(invoice.warehouse?.branch_name || "", margin, 20);
  doc.text(invoice.warehouse?.branch_address || "", margin, 25);

  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text(`Invoice ${invoice.invoice_number}`, pageWidth - margin, 14, { align: "right" });
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.text(`Billing Date: ${formatDate(invoice.invoice_date)}`, pageWidth - margin, 20, { align: "right" });
  doc.text(`Billing Period: ${formatDate(invoice.billing_period_start)} - ${formatDate(invoice.billing_period_end)}`, pageWidth - margin, 25, { align: "right" });

  doc.setDrawColor(200);
  doc.line(margin, 29, pageWidth - margin, 29);

  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  doc.text("Bill To:", margin, 35);
  doc.setFont(undefined, "normal");
  doc.text(invoice.party?.party_name || "", margin, 40);
  doc.text(invoice.party?.phone || "", margin, 45);

  autoTable(doc, {
    startY: 50,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: [124, 94, 60] },
    head: [["Container", "Arrival", "Period", "Days", "Basis", "Rate", "Total"]],
    body: invoice.items.map((i) => [
      i.container_number,
      formatDate(i.arrival_date),
      `${formatDate(i.billing_start)} - ${formatDate(i.billing_end)}`,
      i.billable_days,
      i.rent_type,
      formatCurrency(i.rent_rate, symbol),
      formatCurrency(i.calculated_rent, symbol),
    ]),
  });

  const finalY = doc.lastAutoTable.finalY + 4;
  const totalsX = pageWidth - margin - 55;
  doc.setFontSize(9);
  doc.text("Subtotal:", totalsX, finalY);
  doc.text(formatCurrency(invoice.subtotal, symbol), pageWidth - margin, finalY, { align: "right" });
  doc.text("Paid:", totalsX, finalY + 5);
  doc.text(formatCurrency(invoice.paid_amount, symbol), pageWidth - margin, finalY + 5, { align: "right" });
  doc.setFont(undefined, "bold");
  doc.text("Balance:", totalsX, finalY + 10);
  doc.text(formatCurrency(invoice.balance, symbol), pageWidth - margin, finalY + 10, { align: "right" });

  const sigY = Math.min(finalY + 28, doc.internal.pageSize.getHeight() - 12);
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.text("Prepared By: ____________________", margin, sigY);
  doc.text("Customer Signature: ____________________", pageWidth / 2 - 20, sigY);
  doc.text("Authorized Signature: ____________________", pageWidth - margin - 55, sigY);

  const filename = `Invoice_${sanitizeFilename(invoice.party?.party_name || "Party")}_${invoice.invoice_date}.pdf`;
  return { doc, filename };
}

export function downloadInvoicePdf(invoice) {
  const { doc, filename } = generateInvoicePdf(invoice);
  doc.save(filename);
}

/** Party statement PDF (spec #43). */
export function downloadStatementPdf(party, entries, outstanding, symbol = "Rs.") {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.setFont(undefined, "bold");
  doc.text(`Statement — ${party.party_name}`, 14, 16);
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.text(`Generated: ${formatDate(new Date().toISOString().slice(0, 10))}`, 14, 22);

  autoTable(doc, {
    startY: 28,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [124, 94, 60] },
    head: [["Date", "Type", "Reference", "Amount"]],
    body: entries.map((e) => [formatDate(e.date), e.type === "invoice" ? "Invoice" : "Payment", e.ref, formatCurrency(Math.abs(e.amount), symbol)]),
  });

  const finalY = doc.lastAutoTable.finalY + 8;
  doc.setFont(undefined, "bold");
  doc.text(`Outstanding Balance: ${formatCurrency(outstanding, symbol)}`, 14, finalY);

  doc.save(`Statement_${sanitizeFilename(party.party_name)}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
