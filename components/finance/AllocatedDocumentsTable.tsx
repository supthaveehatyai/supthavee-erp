import Link from "next/link";
import type { DocumentAllocationRow } from "@/types/document-allocation";
import {
  OriginalReceiptStatusToggle,
  type ReceiptStatusLabelMode,
} from "@/components/finance/OriginalReceiptStatusToggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatSignedCreditMoney,
  isAllocationCreditDocType,
  isCreditNoteDocType,
  signedAllocationAmount,
  sumSignedAllocations,
} from "@/lib/utils/rec-payment-summary";
import { roundMoney } from "@/lib/utils/payment-fifo";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isDepositAllocation(docType: string): boolean {
  return docType === "DEP_IN" || docType === "DEP_OUT";
}

function isExpenseAllocation(row: DocumentAllocationRow): boolean {
  return row.target_doc_type === "EXPENSE" || Boolean(row.expense_id);
}

function formatAllocatedAmount(row: DocumentAllocationRow): string {
  const signed = signedAllocationAmount(
    Number(row.allocated_amount ?? 0),
    row.target_doc_type,
  );
  if (isAllocationCreditDocType(row.target_doc_type)) {
    return formatSignedCreditMoney(signed);
  }
  return formatMoney(signed);
}

export type AllocatedDocumentsTableProps = {
  rows: DocumentAllocationRow[];
  /** Base path for target document links — `/purchases` or `/sales`. */
  detailBasePath: "/purchases" | "/sales";
  /** Parent document type drives status button wording. */
  statusLabelMode?: ReceiptStatusLabelMode;
  error?: string | null;
};

/**
 * Allocated invoices under PAY / REC.
 * CN / DEP_IN / DEP_OUT render as GAAP deductions (leading minus).
 * Footer = INV/TAX/CS/BN − CN − DEP (= Net Cash on the summary card when WHT = 0).
 * Status column uses client toggle → Server Action updateReceiptStatus.
 */
export function AllocatedDocumentsTable({
  rows,
  detailBasePath,
  statusLabelMode = "PAY",
  error,
}: AllocatedDocumentsTableProps) {
  const statusColumnLabel =
    statusLabelMode === "REC"
      ? "สถานะการออกเอกสาร"
      : "สถานะเอกสารใบเสร็จ";

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
        ไม่พบรายการเอกสารที่ตัดชำระ
      </div>
    );
  }

  const totalWht = roundMoney(
    rows.reduce((sum, row) => sum + Number(row.wht_amount ?? 0), 0),
  );
  /** INV/TAX/CS/BN − CN − DEP (= Net Cash when WHT = 0). */
  const netTotal = sumSignedAllocations(rows);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead>เลขที่เอกสารภายใน</TableHead>
            <TableHead>เลขอ้างอิงภายนอก</TableHead>
            <TableHead className="text-right">ยอดที่ตัดชำระ</TableHead>
            <TableHead className="text-right">หัก ณ ที่จ่าย (WHT)</TableHead>
            <TableHead className="text-center">{statusColumnLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isDeposit = isDepositAllocation(row.target_doc_type);
            const isCn = isCreditNoteDocType(row.target_doc_type);
            const isCredit = isAllocationCreditDocType(row.target_doc_type);
            const isExpense = isExpenseAllocation(row);
            const expenseHref = row.expense_id
              ? `/expenses/${encodeURIComponent(row.expense_id)}`
              : `/expenses`;
            // Deposits link to their own detail path
            const hrefBase =
              row.target_doc_type === "DEP_OUT" ||
              row.target_doc_type === "TB" ||
              row.target_doc_type.startsWith("AP_") ||
              row.target_doc_type === "PO" ||
              row.target_doc_type === "PAY"
                ? "/purchases"
                : detailBasePath;
            const href = isExpense
              ? expenseHref
              : `${hrefBase}/${encodeURIComponent(row.target_doc_no)}`;

            const docNoLabel = isCn
              ? `(หัก) ใบลดหนี้ ${row.target_doc_no}`
              : isDeposit
                ? `(หัก) มัดจำ ${row.target_doc_no}`
                : row.target_doc_no;

            return (
              <TableRow
                key={row.id}
                className={
                  isCn
                    ? "bg-red-50/40"
                    : isDeposit
                      ? "bg-emerald-50/40"
                      : undefined
                }
              >
                <TableCell>
                  <Link
                    href={href}
                    className={
                      isCn
                        ? "font-mono text-sm font-semibold text-destructive underline-offset-2 hover:underline"
                        : isDeposit
                          ? "font-mono text-sm font-semibold text-emerald-800 underline-offset-2 hover:underline"
                          : "font-mono text-sm font-semibold text-blue-700 underline-offset-2 hover:underline"
                    }
                  >
                    {docNoLabel}
                  </Link>
                  {row.target_doc_type ? (
                    <span className="ml-1.5 text-xs text-slate-400">
                      ({isExpense ? "EXP" : row.target_doc_type})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-sm text-slate-600">
                  {row.reference_no?.trim() || "—"}
                </TableCell>
                <TableCell
                  className={
                    isCn
                      ? "text-right font-semibold tabular-nums text-destructive"
                      : isDeposit
                        ? "text-right font-semibold tabular-nums text-emerald-700"
                        : "text-right font-semibold tabular-nums text-slate-900"
                  }
                >
                  {formatAllocatedAmount(row)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-700">
                  {row.wht_amount > 0 ? formatMoney(row.wht_amount) : "—"}
                </TableCell>
                <TableCell className="text-center">
                  {isCredit || isExpense ? (
                    <span className="text-xs text-slate-400">—</span>
                  ) : (
                    <OriginalReceiptStatusToggle
                      allocationId={row.id}
                      isReceived={row.original_receipt_received}
                      labelMode={statusLabelMode}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-slate-50/80">
            <TableCell
              colSpan={2}
              className="text-right text-sm font-semibold text-slate-700"
            >
              รวมสุทธิ (บิล − มัดจำ)
            </TableCell>
            <TableCell className="text-right text-sm font-bold tabular-nums text-blue-800">
              {formatMoney(netTotal)}
            </TableCell>
            <TableCell className="text-right text-sm font-bold tabular-nums text-slate-800">
              {totalWht > 0 ? formatMoney(totalWht) : "—"}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
