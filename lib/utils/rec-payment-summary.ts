/**
 * REC knock-off summary — shared by Payment Form (client) and Server Action.
 * Remaining / CN amounts stay unsigned in data; Net Cash applies the minus here.
 */

import { roundMoney } from "@/lib/utils/payment-fifo";

export function isCreditNoteDocType(docType: string): boolean {
  return String(docType ?? "").trim().toUpperCase() === "CN";
}

/** Contra docs: reduce Net Cash (GAAP) — stored unsigned in DB. */
const ALLOCATION_CREDIT_DOC_TYPES = new Set(["CN", "DEP_IN", "DEP_OUT"]);

export function isAllocationCreditDocType(
  docType: string | null | undefined,
): boolean {
  return ALLOCATION_CREDIT_DOC_TYPES.has(
    String(docType ?? "").trim().toUpperCase(),
  );
}

/**
 * Signed knock-off amount for Detail / Print tables.
 * Sales / AP / BN / EXPENSE add; CN and deposits subtract.
 */
export function signedAllocationAmount(
  amount: number,
  docType: string | null | undefined,
): number {
  const abs = Math.abs(Number(amount) || 0);
  return isAllocationCreditDocType(docType) ? -abs : abs;
}

export function sumSignedAllocations(
  rows: Array<{
    target_doc_type?: string | null;
    allocated_amount?: number | null;
  }>,
): number {
  return roundMoney(
    rows.reduce(
      (sum, row) =>
        sum +
        signedAllocationAmount(
          Number(row.allocated_amount ?? 0),
          row.target_doc_type,
        ),
      0,
    ),
  );
}

export type RecPaymentLineInput = {
  invoice_id: string;
  allocated_amount: number;
  wht_amount: number;
};

export type RecPaymentDocTypeInput = {
  id: string;
  doc_type: string;
};

export type RecPaymentSummary = {
  /** SUM(allocated_amount) of sales invoices — unsigned. */
  totalInvoices: number;
  /** SUM(allocated_amount) of CN rows — unsigned. */
  totalCnApplied: number;
  depositApplied: number;
  whtAmount: number;
  /**
   * Total Invoices − Total CN − Deposit − WHT.
   * May be negative when CN/deposit/WHT exceed invoices (UI must block submit).
   */
  netCash: number;
};

export function splitRecAllocationTotals(
  lines: RecPaymentLineInput[],
  documents: RecPaymentDocTypeInput[],
): Pick<RecPaymentSummary, "totalInvoices" | "totalCnApplied" | "whtAmount"> {
  const docTypeById = new Map(
    documents.map((doc) => [doc.id, String(doc.doc_type ?? "")]),
  );

  let totalInvoices = 0;
  let totalCnApplied = 0;
  let whtAmount = 0;

  for (const line of lines) {
    const docType = docTypeById.get(line.invoice_id) ?? "";
    const allocated = roundMoney(Math.max(0, line.allocated_amount));
    const wht = roundMoney(Math.max(0, line.wht_amount));

    if (isCreditNoteDocType(docType)) {
      totalCnApplied = roundMoney(totalCnApplied + allocated);
      continue;
    }

    totalInvoices = roundMoney(totalInvoices + allocated);
    whtAmount = roundMoney(whtAmount + wht);
  }

  return { totalInvoices, totalCnApplied, whtAmount };
}

export function summarizeRecPayment(input: {
  totalInvoices: number;
  totalCnApplied: number;
  depositApplied: number;
  whtAmount: number;
}): RecPaymentSummary {
  const totalInvoices = roundMoney(input.totalInvoices);
  const totalCnApplied = roundMoney(input.totalCnApplied);
  const depositApplied = roundMoney(input.depositApplied);
  const whtAmount = roundMoney(input.whtAmount);
  const netCash = roundMoney(
    totalInvoices - totalCnApplied - depositApplied - whtAmount,
  );

  return {
    totalInvoices,
    totalCnApplied,
    depositApplied,
    whtAmount,
    netCash,
  };
}

export function formatSignedCreditMoney(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (abs === 0) return formatted;
  return `-${formatted}`;
}
