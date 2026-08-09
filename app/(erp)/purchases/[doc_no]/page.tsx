import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, FileInput } from "lucide-react";
import { getDocumentByNo } from "@/lib/actions/document-actions";
import {
  getDepositAllocationHistory,
  getDocumentAllocationsByReceiptId,
} from "@/lib/actions/finance/allocations";
import { PURCHASE_DOC_TYPES } from "@/lib/constants/document";
import type { DocumentDetail, DocumentStatus, DocumentType } from "@/types/document";
import { AllocatedDocumentsTable } from "@/components/finance/AllocatedDocumentsTable";
import { DepositAllocationHistoryTable } from "@/components/finance/DepositAllocationHistoryTable";
import { DepositBalanceActions } from "@/components/finance/DepositBalanceActions";
import PrintPaymentReceiptTemplate from "@/components/finance/PrintPaymentReceiptTemplate";
import PrintDocumentButton from "@/components/finance/PrintDocumentButton";
import PrintDocumentTemplate from "@/components/sales/print-document-template";
import PrintSettlementVoucherTemplate from "@/components/finance/PrintSettlementVoucherTemplate";
import { ReferenceDocumentsSection } from "@/components/finance/ReferenceDocumentsSection";
import { AttachmentSheetViewer } from "@/components/shared/attachment-sheet-viewer";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PageProps = {
  params: Promise<{ doc_no: string }>;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusBadge(status: DocumentStatus) {
  if (status === "COMPLETED" || status === "ISSUED") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
        {status === "COMPLETED" ? "COMPLETED" : status}
      </Badge>
    );
  }
  if (status === "DRAFT") {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
        DRAFT
      </Badge>
    );
  }
  return (
    <Badge variant="slate" className="font-semibold">
      {status}
    </Badge>
  );
}

function isPurchaseDocType(docType: DocumentType): boolean {
  return (PURCHASE_DOC_TYPES as readonly string[]).includes(docType);
}

function resolveSlipUrl(doc: DocumentDetail): string | null {
  const url =
    doc.attachment_url?.trim() || doc.attached_file_url?.trim() || "";
  return url || null;
}

function extractSettlementRemark(notes: string | null | undefined): string {
  const raw = String(notes ?? "").trim();
  if (!raw) return "—";
  const match = raw.match(/remark=([^|]+)/i);
  const fromFlag = match?.[1]?.trim() ?? "";
  if (fromFlag) return fromFlag;
  return raw;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { doc_no } = await params;
  const decoded = decodeURIComponent(doc_no);
  return {
    title: `เอกสารซื้อ ${decoded} | Purchases`,
    description: `รายละเอียดเอกสารซื้อ ${decoded}`,
  };
}

/**
 * Server Component — purchase document read-only view.
 * Data via `getDocumentByNo` (Service Role). No client Supabase.
 */
export default async function PurchaseDocumentDetailPage({
  params,
}: PageProps) {
  const { doc_no: rawDocNo } = await params;
  const docNo = decodeURIComponent(rawDocNo);

  const result = await getDocumentByNo(docNo);
  if (result.error || !result.data) {
    notFound();
  }

  const doc: DocumentDetail = result.data;
  if (!isPurchaseDocType(doc.doc_type)) {
    notFound();
  }

  const isPaymentDoc = doc.doc_type === "PAY";
  const isDepositDoc = doc.doc_type === "DEP_OUT";
  const isSettlementDoc =
    doc.doc_type === "AP_REFUND" || doc.doc_type === "AP_WRITEOFF";
  const allocationsResult =
    isPaymentDoc || isSettlementDoc
      ? await getDocumentAllocationsByReceiptId(doc.id)
      : { data: [], error: null };
  const depositHistoryResult = isDepositDoc
    ? await getDepositAllocationHistory(doc.id)
    : { data: [], error: null };

  const grandTotal = Number(doc.grand_total ?? 0);
  const depositDeducted = Number(doc.deposit_deducted ?? 0);
  const depositUsedFromHistory = depositHistoryResult.data.reduce(
    (sum, row) => sum + row.allocated_amount,
    0,
  );
  const depositUsed = Math.max(depositDeducted, depositUsedFromHistory);
  const depositAvailable = Math.max(0, grandTotal - depositUsed);
  const subTotal = Number(
    doc.net_before_vat ?? doc.total_amount ?? doc.sub_total ?? 0,
  );
  const vatAmount = Number(doc.vat_amount ?? doc.tax_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 0);
  const vatType = doc.vat_type ?? "NONE";
  const vatTypeLabel =
    vatType === "NONE"
      ? "Non-VAT"
      : vatType === "INCLUSIVE"
        ? `รวม VAT ${vatRate}%`
        : vatType === "EXCLUSIVE"
          ? `แยก VAT ${vatRate}%`
          : String(vatType);
  const slipUrl = resolveSlipUrl(doc);
  const settlementTitle =
    doc.doc_type === "AP_REFUND"
      ? "ใบสำคัญรับเงินคืน (Refund Receipt)"
      : "ใบสำคัญปรับปรุงบัญชี - ตัดเป็นค่าใช้จ่าย (Write-off Expense)";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6 print:max-w-none print:gap-0 print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <FileInput className="size-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-bold tracking-tight text-slate-900">
                {doc.doc_no}
              </h1>
              {statusBadge(doc.status)}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {doc.doc_type} · วันที่เอกสาร {formatDate(doc.doc_date)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/purchases"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <ArrowLeft className="size-4" />
            กลับรายการเอกสารซื้อ
          </Link>
          {isPaymentDoc || isDepositDoc || isSettlementDoc ? (
            <PrintDocumentButton className="h-10 gap-2" />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4 print:hidden">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ซัพพลายเออร์</CardTitle>
            <CardDescription>ข้อมูลจาก contacts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-base font-semibold text-slate-900">
              {doc.contact?.company_name ?? "—"}
            </p>
            {doc.contact_person?.name ? (
              <p className="text-slate-600">
                ผู้ติดต่อ: {doc.contact_person.name}
              </p>
            ) : null}
            {doc.contact?.phone ? (
              <p className="text-slate-500">โทร: {doc.contact.phone}</p>
            ) : null}
            {!isPaymentDoc ? (
              <div className="border-t border-slate-100 pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  เลขที่บิลผู้จำหน่าย (Reference No.)
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-slate-800">
                  {doc.reference_no?.trim() || "—"}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">สรุปยอด (Summary)</CardTitle>
            <CardDescription>
              {isSettlementDoc
                ? `${settlementTitle} · ${vatTypeLabel}`
                : isDepositDoc
                  ? `เอกสารมัดจำจ่าย · ${vatTypeLabel} · สถานะ ${doc.payment_status}`
                  : `สถานะ ${doc.payment_status}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {isPaymentDoc ? (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                  <span className="text-base font-bold text-slate-900">
                    มูลค่าบิลที่ตัดยอด (Grand Total)
                  </span>
                  <span className="text-lg font-bold tabular-nums text-orange-700">
                    {formatMoney(grandTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>ยอดจ่ายชำระจริง (Net Cash)</span>
                  <span className="tabular-nums font-semibold text-slate-900">
                    {formatMoney(
                      Number(doc.total_amount ?? doc.sub_total ?? 0),
                    )}
                  </span>
                </div>
              </>
            ) : isSettlementDoc ? (
              <>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>วันที่เอกสาร</span>
                  <span className="tabular-nums font-medium text-slate-800">
                    {formatDate(doc.doc_date)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>หมายเหตุ</span>
                  <span className="max-w-[14rem] text-right text-slate-800">
                    {extractSettlementRemark(doc.notes)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>ยอดก่อนภาษี (Net Total)</span>
                  <span className="tabular-nums font-medium text-slate-800">
                    {formatMoney(subTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>
                    ภาษีมูลค่าเพิ่ม{" "}
                    {vatType !== "NONE" ? `${vatRate}%` : ""}{" "}
                    <span className="text-xs text-slate-400">
                      · {vatTypeLabel}
                    </span>
                  </span>
                  <span className="tabular-nums font-medium text-slate-800">
                    {formatMoney(vatAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                  <span className="text-base font-bold text-slate-900">
                    ยอดรวมสุทธิ (Grand Total)
                  </span>
                  <span className="text-lg font-bold tabular-nums text-orange-700">
                    {formatMoney(grandTotal)}
                  </span>
                </div>
              </>
            ) : isDepositDoc ? (
              <>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>ยอดก่อนภาษี (Net Total)</span>
                  <span className="tabular-nums font-medium text-slate-800">
                    {formatMoney(subTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>
                    ภาษีมูลค่าเพิ่ม{" "}
                    {vatType !== "NONE" ? `${vatRate}%` : ""}{" "}
                    <span className="text-xs text-slate-400">
                      · {vatTypeLabel}
                    </span>
                  </span>
                  <span className="tabular-nums font-medium text-slate-800">
                    {formatMoney(vatAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                  <span className="text-base font-bold text-slate-900">
                    ยอดรวมสุทธิ (Grand Total)
                  </span>
                  <span className="text-lg font-bold tabular-nums text-orange-700">
                    {formatMoney(grandTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>ยอดที่นำไปใช้แล้ว</span>
                  <span className="tabular-nums font-medium text-slate-800">
                    {formatMoney(depositUsed)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>ยอดคงเหลือ (Balance)</span>
                  <span className="tabular-nums font-semibold text-emerald-700">
                    {formatMoney(depositAvailable)}
                  </span>
                </div>
                {depositAvailable > 0.02 ? (
                  <div className="border-t border-slate-100 pt-3">
                    <DepositBalanceActions
                      documentId={doc.id}
                      docNo={doc.doc_no}
                      availableBalance={depositAvailable}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>ยอดรวมสินค้า (Subtotal / Net Before VAT)</span>
                  <span className="tabular-nums font-medium text-slate-800">
                    {formatMoney(subTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <span>
                    ภาษีมูลค่าเพิ่ม (VAT){" "}
                    <span className="text-xs text-slate-400">
                      · {vatTypeLabel}
                    </span>
                  </span>
                  <span className="tabular-nums font-medium text-slate-800">
                    {formatMoney(vatAmount)}
                  </span>
                </div>
                {doc.discount_amount > 0 ? (
                  <div className="flex items-center justify-between gap-3 text-slate-600">
                    <span>ส่วนลดท้ายบิล</span>
                    <span className="tabular-nums font-medium text-slate-800">
                      -{formatMoney(doc.discount_amount)}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                  <span className="text-base font-bold text-slate-900">
                    ยอดสุทธิ (Grand Total)
                  </span>
                  <span className="text-lg font-bold tabular-nums text-blue-700">
                    {formatMoney(grandTotal)}
                  </span>
                </div>
              </>
            )}

            {slipUrl ? (
              <AttachmentSheetViewer
                fileUrl={slipUrl}
                title={`สลิปโอนเงิน · ${doc.doc_no}`}
                trigger={
                  <button
                    type="button"
                    className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 text-sm font-semibold text-orange-800 transition hover:bg-orange-100"
                  >
                    <Eye className="size-4" />
                    ดูสลิปโอนเงิน
                  </button>
                }
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {isPaymentDoc ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              รายการเอกสารที่ตัดชำระ (Allocated Documents)
            </CardTitle>
            <CardDescription>
              {allocationsResult.data.length} รายการจาก document_allocations
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <AllocatedDocumentsTable
              rows={allocationsResult.data}
              detailBasePath="/purchases"
              statusLabelMode="PAY"
              error={allocationsResult.error}
            />
          </CardContent>
        </Card>
      ) : isSettlementDoc ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              เอกสารต้นทางที่อ้างอิง (Source Deposit)
            </CardTitle>
            <CardDescription>
              {allocationsResult.data.length} รายการจาก document_allocations
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <AllocatedDocumentsTable
              rows={allocationsResult.data}
              detailBasePath="/purchases"
              statusLabelMode="PAY"
              error={allocationsResult.error}
            />
          </CardContent>
        </Card>
      ) : isDepositDoc ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              ประวัติการใช้งานมัดจำ (Allocation History)
            </CardTitle>
            <CardDescription>
              {depositHistoryResult.data.length} รายการที่นำไปตัดชำระผ่าน PAY
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <DepositAllocationHistoryTable
              rows={depositHistoryResult.data}
              receiptBasePath="/purchases"
              invoiceBasePath="/purchases"
              error={depositHistoryResult.error}
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">รายการสินค้า</CardTitle>
            <CardDescription>{doc.items.length} รายการ</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>รายการ</TableHead>
                    <TableHead className="text-right">จำนวน</TableHead>
                    <TableHead className="text-right">ราคา/หน่วย</TableHead>
                    <TableHead className="text-right">รวม</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.items.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-20 text-center text-slate-500"
                      >
                        ไม่มีรายการสินค้า
                      </TableCell>
                    </TableRow>
                  ) : (
                    doc.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium text-slate-900">
                            {item.description || item.product_name || "—"}
                          </div>
                          {item.sku ? (
                            <div className="font-mono text-xs text-slate-400">
                              {item.sku}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.qty} {item.uom_used ?? ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(item.unit_price)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatMoney(item.line_total)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {isPaymentDoc ? (
        <ReferenceDocumentsSection
          documentId={doc.id}
          mode="PAY"
          whtAttachmentUrl={doc.wht_attachment_url}
          originalReceiptUrl={doc.original_receipt_url}
        />
      ) : null}
      </div>

      {isPaymentDoc ? (
        <PrintPaymentReceiptTemplate
          document={doc}
          allocations={allocationsResult.data}
          mode="PAY"
          className="mt-2 print:mt-0"
        />
      ) : isSettlementDoc ? (
        <PrintSettlementVoucherTemplate
          document={doc}
          allocations={allocationsResult.data}
          detailBasePath="/purchases"
          className="mt-2 print:mt-0"
        />
      ) : isDepositDoc ? (
        <PrintDocumentTemplate document={doc} className="mt-2 print:mt-0" />
      ) : null}
    </div>
  );
}
