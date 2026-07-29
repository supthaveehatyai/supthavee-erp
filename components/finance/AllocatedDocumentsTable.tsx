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

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead>เลขที่เอกสารภายใน</TableHead>
            <TableHead>เลขอ้างอิงภายนอก</TableHead>
            <TableHead className="text-right">ยอดที่ตัดชำระ</TableHead>
            <TableHead className="text-center">{statusColumnLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link
                  href={`${detailBasePath}/${encodeURIComponent(row.target_doc_no)}`}
                  className="font-mono text-sm font-semibold text-blue-700 underline-offset-2 hover:underline"
                >
                  {row.target_doc_no}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-sm text-slate-600">
                {row.reference_no?.trim() || "—"}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-slate-900">
                {formatMoney(row.allocated_amount)}
                {row.wht_amount > 0 ? (
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    (+WHT {formatMoney(row.wht_amount)})
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-center">
                <OriginalReceiptStatusToggle
                  allocationId={row.id}
                  isReceived={row.original_receipt_received}
                  labelMode={statusLabelMode}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
