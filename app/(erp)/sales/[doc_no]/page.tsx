import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, FileText, Link2, Pencil } from "lucide-react";
import { getDocumentByNo } from "@/lib/actions/document-actions";
import {
  getDepositAllocationHistory,
  getDocumentAllocationsByReceiptId,
} from "@/lib/actions/finance/allocations";
import type { DocumentDetail, DocumentStatus, DocumentType } from "@/types/document";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import { SALES_DOC_TYPES } from "@/lib/constants/document";
import PrintDocumentTemplate from "@/components/sales/print-document-template";
import PrintPaymentReceiptTemplate from "@/components/finance/PrintPaymentReceiptTemplate";
import PrintSettlementVoucherTemplate from "@/components/finance/PrintSettlementVoucherTemplate";
import { AllocatedDocumentsTable } from "@/components/finance/AllocatedDocumentsTable";
import { DepositAllocationHistoryTable } from "@/components/finance/DepositAllocationHistoryTable";
import { DepositBalanceActions } from "@/components/finance/DepositBalanceActions";
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
import IssueDocumentButton from "./issue-document-button";
import DeleteDraftDocumentButton from "./delete-draft-document-button";
import VoidDocumentActions from "./void-document-actions";
import DuplicateDocumentButton from "./duplicate-document-button";
import PrintDocumentButton from "@/components/finance/PrintDocumentButton";
import { LineItemProductThumb } from "@/components/sales/LineItemProductThumb";
import ConvertDocumentDropdown from "./convert-document-dropdown";
import { SendToProductionButton } from "@/components/production/send-to-production-button";

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
        {status === "COMPLETED" ? "COMPLETED (ออกเอกสารแล้ว)" : status}
      </Badge>
    );
  }
  if (status === "DRAFT") {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
        DRAFT (ร่าง)
      </Badge>
    );
  }
  return (
    <Badge variant="slate" className="font-semibold">
      {status}
    </Badge>
  );
}

function SummaryRow({
  label,
  value,
  emphasize = false,
  negative = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={
          emphasize
            ? "text-base font-bold text-slate-900"
            : "text-sm text-slate-500"
        }
      >
        {label}
      </span>
      <span
        className={
          emphasize
            ? "text-lg font-bold tabular-nums text-blue-700"
            : negative
              ? "text-sm font-medium tabular-nums text-red-600"
              : "text-sm font-medium tabular-nums text-slate-800"
        }
      >
        {value}
      </span>
    </div>
  );
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { doc_no } = await params;
  const decoded = decodeURIComponent(doc_no);
  return {
    title: `เอกสาร ${decoded} | Sales`,
    description: `รายละเอียดเอกสารขาย ${decoded}`,
  };
}

function isSalesDocType(docType: DocumentType): boolean {
  return (SALES_DOC_TYPES as readonly string[]).includes(docType);
}

function extractSettlementRemark(notes: string | null | undefined): string {
  const raw = String(notes ?? "").trim();
  if (!raw) return "—";
  const match = raw.match(/remark=([^|]+)/i);
  const fromFlag = match?.[1]?.trim() ?? "";
  if (fromFlag) return fromFlag;
  return raw;
}

/**
 * Server Component — document read-only view + A4 print layout.
 * Data via `getDocumentByNo` (Service Role). No client Supabase.
 */
export default async function SalesDocumentDetailPage({ params }: PageProps) {
  const { doc_no: rawDocNo } = await params;
  const docNo = decodeURIComponent(rawDocNo ?? "").trim();
  if (!docNo) {
    notFound();
  }

  let result: Awaited<ReturnType<typeof getDocumentByNo>>;
  try {
    result = await getDocumentByNo(docNo);
  } catch (err) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err instanceof Error ? err.message : "โหลดเอกสารขายไม่สำเร็จ"}
        </div>
      </div>
    );
  }

  if (!result.data) {
    if (result.error && !/ไม่พบเอกสาร/.test(result.error)) {
      return (
        <div className="mx-auto max-w-3xl p-6">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {result.error}
          </div>
        </div>
      );
    }
    notFound();
  }

  const doc: DocumentDetail = result.data;
  if (!isSalesDocType(doc.doc_type)) {
    notFound();
  }

  const isReceiptDoc = doc.doc_type === "REC";
  const isDepositDoc = doc.doc_type === "DEP_IN";
  const isSettlementDoc =
    doc.doc_type === "AR_REFUND" || doc.doc_type === "AR_WRITEOFF";
  const allocationsResult =
    isReceiptDoc || isSettlementDoc
      ? await getDocumentAllocationsByReceiptId(doc.id)
      : { data: [], error: null };
  const depositHistoryResult = isDepositDoc
    ? await getDepositAllocationHistory(doc.id)
    : { data: [], error: null };
  const slipUrl =
    doc.attachment_url?.trim() || doc.attached_file_url?.trim() || "";
  const canIssue = doc.status === "DRAFT";
  const canPrint =
    isReceiptDoc ||
    isSettlementDoc ||
    doc.status === "DRAFT" ||
    doc.status === "COMPLETED" ||
    doc.status === "ISSUED";
  const activeChildren = (doc.child_documents ?? []).filter(
    (child) => child.status !== "CANCELLED" && child.status !== "VOID",
  );
  const primaryChild = activeChildren[0] ?? null;
  const isAlreadyConverted = activeChildren.length > 0;
  const canConvert =
    ((doc.doc_type === "QT" && doc.status === "COMPLETED") ||
      (doc.doc_type === "SO" && doc.status === "ISSUED")) &&
    !isAlreadyConverted;
  const canVoid =
    doc.status === "ISSUED" && Number(doc.paid_amount ?? 0) === 0;
  /** MTO — SO / TAX_INV / ABB / CS_TAX / INV_DO ที่ ISSUED เท่านั้น (ห้าม DRAFT) */
  const canSendToProduction =
    (doc.doc_type === "SO" ||
      doc.doc_type === "TAX_INV" ||
      doc.doc_type === "ABB" ||
      doc.doc_type === "CS_TAX" ||
      doc.doc_type === "INV_DO") &&
    doc.status === "ISSUED";
  const canDuplicate =
    !isReceiptDoc &&
    !isSettlementDoc &&
    doc.doc_type !== "DEP_IN" &&
    doc.status !== "DRAFT";
  const subtotal = Number(doc.total_amount ?? doc.sub_total ?? 0);
  const discountAmount = Number(doc.discount_amount ?? 0);
  const netBeforeVat = Number(doc.net_before_vat ?? subtotal - discountAmount);
  const vatAmount = Number(doc.vat_amount ?? doc.tax_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 7);
  const grandTotal = Number(doc.grand_total ?? 0);
  const depositDeducted = Number(doc.deposit_deducted ?? 0);
  const depositUsedFromHistory = depositHistoryResult.data.reduce(
    (sum, row) => sum + row.allocated_amount,
    0,
  );
  const depositUsed = Math.max(depositDeducted, depositUsedFromHistory);
  const depositAvailable = Math.max(0, grandTotal - depositUsed);
  const settlementTitle =
    doc.doc_type === "AR_REFUND"
      ? "ใบสำคัญจ่ายเงินคืน (Refund Payment)"
      : "ใบสำคัญปรับปรุงบัญชี - รับรู้รายได้ (Write-off Income)";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6 print:max-w-none print:gap-0 print:p-0">
      {/* Screen-only chrome / actions */}
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <FileText className="size-5" />
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

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Link
            href="/sales/create"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <ArrowLeft className="size-4" />
            เปิดบิลใหม่
          </Link>
          {canPrint && <PrintDocumentButton className="h-10 gap-2" />}
          {canSendToProduction && (
            <SendToProductionButton
              documentId={doc.id}
              documentNo={doc.doc_no}
            />
          )}
          {canDuplicate && (
            <DuplicateDocumentButton documentId={doc.id} docNo={doc.doc_no} />
          )}
          {canConvert && (
            <ConvertDocumentDropdown
              sourceDocId={doc.id}
              sourceDocNo={doc.doc_no}
              sourceDocType={doc.doc_type}
            />
          )}
          {canIssue && (
            <Link
              href={`/sales/edit/${encodeURIComponent(doc.id)}`}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
            >
              <Pencil className="size-4" />
              {DOCUMENT_ACTIONS.EDIT}
            </Link>
          )}
          {canIssue && (
            <IssueDocumentButton documentId={doc.id} docNo={doc.doc_no} />
          )}
          {canIssue && (
            <DeleteDraftDocumentButton documentId={doc.id} docNo={doc.doc_no} />
          )}
          {canVoid && (
            <VoidDocumentActions documentId={doc.id} docNo={doc.doc_no} />
          )}
        </div>
      </div>

      {/* Screen-only interactive / card view */}
      <div className="flex flex-col gap-4 print:hidden">
        {primaryChild ? (
          <div
            role="status"
            className="flex flex-wrap items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sky-950"
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700">
              <Link2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                เอกสารถูกอ้างอิงไปแล้ว: นำไปสร้างเป็นเอกสาร{" "}
                <Link
                  href={`/sales/${encodeURIComponent(primaryChild.doc_no)}`}
                  className="font-mono underline decoration-sky-400 underline-offset-2 hover:text-sky-800"
                >
                  {primaryChild.doc_no}
                </Link>
              </p>
              <p className="mt-0.5 text-xs text-sky-800/80">
                ประเภท {primaryChild.doc_type} · สถานะ {primaryChild.status}
                {activeChildren.length > 1
                  ? ` · รวม ${activeChildren.length} เอกสารต่อยอด`
                  : ""}
                {" — "}ไม่สามารถสร้างเอกสารต่อยอดซ้ำได้
              </p>
            </div>
            <Badge className="border-sky-200 bg-white text-sky-800 hover:bg-white">
              Lineage Locked
            </Badge>
          </div>
        ) : null}

        {doc.notes?.trim() ? (
          <Card className="border-amber-200 bg-amber-50/40 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">หมายเหตุ / Remark</CardTitle>
              <CardDescription>
                แสดงบนเอกสารพิมพ์สำหรับผู้ตรวจสอบ
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-slate-800">
                {doc.notes.trim()}
              </p>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">ลูกค้า</CardTitle>
              <CardDescription>
                ข้อมูลจาก contacts / contact_persons
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-base font-semibold text-slate-900">
                {doc.contact?.company_name ?? "—"}
              </p>
              {doc.contact?.tax_id && (
                <p className="text-slate-600">
                  เลขผู้เสียภาษี: {doc.contact.tax_id}
                </p>
              )}
              {doc.contact?.branch_code && (
                <p className="text-slate-600">
                  สาขา: {doc.contact.branch_code}
                </p>
              )}
              {doc.contact?.address && (
                <p className="whitespace-pre-wrap text-slate-600">
                  {doc.contact.address}
                </p>
              )}
              {doc.contact?.phone && (
                <p className="text-slate-600">โทร: {doc.contact.phone}</p>
              )}
              {doc.contact_person && (
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-500">
                    ผู้ติดต่อ
                  </p>
                  <p className="font-medium text-slate-800">
                    {doc.contact_person.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[
                      doc.contact_person.department_or_role,
                      doc.contact_person.phone,
                      doc.contact_person.email,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">สรุปยอดเงิน</CardTitle>
              <CardDescription>
                {isReceiptDoc
                  ? `เอกสารรับชำระ · สถานะ ${doc.payment_status}`
                  : isDepositDoc
                    ? `เอกสารมัดจำรับ · VAT ${doc.vat_type ?? "NONE"} · สถานะ ${doc.payment_status}`
                    : isSettlementDoc
                      ? `${settlementTitle} · VAT ${doc.vat_type ?? "NONE"}`
                      : `VAT ${doc.vat_type ?? "—"} · อัตรา ${vatRate}%`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {isReceiptDoc ? (
                <>
                  <SummaryRow
                    label="มูลค่าบิลที่ตัดยอด (Grand Total)"
                    value={`${formatMoney(grandTotal)} ฿`}
                    emphasize
                  />
                  <SummaryRow
                    label="ยอดรับชำระจริง (Net Cash)"
                    value={`${formatMoney(Number(doc.total_amount ?? doc.sub_total ?? 0))} ฿`}
                  />
                  {Number(doc.wht_amount ?? 0) > 0 ? (
                    <SummaryRow
                      label="ภาษีหัก ณ ที่จ่าย (WHT)"
                      value={`${formatMoney(Number(doc.wht_amount ?? 0))} ฿`}
                    />
                  ) : null}
                </>
              ) : isSettlementDoc ? (
                <>
                  <SummaryRow
                    label="วันที่เอกสาร"
                    value={formatDate(doc.doc_date)}
                  />
                  <SummaryRow
                    label="หมายเหตุ"
                    value={extractSettlementRemark(doc.notes)}
                  />
                  <SummaryRow
                    label="ยอดก่อนภาษี (Net Total)"
                    value={`${formatMoney(netBeforeVat)} ฿`}
                  />
                  {(doc.vat_type && doc.vat_type !== "NONE") || vatAmount > 0 ? (
                    <SummaryRow
                      label={`ภาษีมูลค่าเพิ่ม ${vatRate}% (${doc.vat_type ?? "—"})`}
                      value={`${formatMoney(vatAmount)} ฿`}
                    />
                  ) : (
                    <SummaryRow
                      label="ภาษีมูลค่าเพิ่ม"
                      value={`${formatMoney(0)} ฿`}
                    />
                  )}
                  <div className="border-t border-slate-200 pt-2.5">
                    <SummaryRow
                      label="ยอดรวมสุทธิ (Grand Total)"
                      value={`${formatMoney(grandTotal)} ฿`}
                      emphasize
                    />
                  </div>
                  {slipUrl ? (
                    <AttachmentSheetViewer
                      fileUrl={slipUrl}
                      title={`สลิปโอนเงิน · ${doc.doc_no}`}
                      trigger={
                        <button
                          type="button"
                          className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
                        >
                          <Eye className="size-4" />
                          ดูสลิปโอนเงิน
                        </button>
                      }
                    />
                  ) : null}
                </>
              ) : isDepositDoc ? (
                <>
                  <SummaryRow
                    label="ยอดก่อนภาษี (Net Total)"
                    value={`${formatMoney(netBeforeVat)} ฿`}
                  />
                  {(doc.vat_type && doc.vat_type !== "NONE") || vatAmount > 0 ? (
                    <SummaryRow
                      label={`ภาษีมูลค่าเพิ่ม ${vatRate}% (${doc.vat_type ?? "—"})`}
                      value={`${formatMoney(vatAmount)} ฿`}
                    />
                  ) : (
                    <SummaryRow
                      label="ภาษีมูลค่าเพิ่ม"
                      value={`${formatMoney(0)} ฿`}
                    />
                  )}
                  <div className="border-t border-slate-200 pt-2.5">
                    <SummaryRow
                      label="ยอดรวมสุทธิ (Grand Total)"
                      value={`${formatMoney(grandTotal)} ฿`}
                      emphasize
                    />
                  </div>
                  <SummaryRow
                    label="ยอดที่นำไปใช้แล้ว"
                    value={`${formatMoney(depositUsed)} ฿`}
                  />
                  <SummaryRow
                    label="ยอดคงเหลือ (Balance)"
                    value={`${formatMoney(depositAvailable)} ฿`}
                  />
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
                  <SummaryRow
                    label="ยอดรวมสินค้า"
                    value={`${formatMoney(subtotal)} ฿`}
                  />
                  <SummaryRow
                    label={`ส่วนลดท้ายบิล${doc.discount_text ? ` (${doc.discount_text})` : ""}`}
                    value={`−${formatMoney(discountAmount)} ฿`}
                    negative
                  />
                  <SummaryRow
                    label="ยอดหลังหักส่วนลด (Net Before VAT)"
                    value={`${formatMoney(netBeforeVat)} ฿`}
                  />
                  <SummaryRow
                    label={`ภาษีมูลค่าเพิ่ม ${vatRate}%`}
                    value={`${formatMoney(vatAmount)} ฿`}
                  />
                  <div className="border-t border-slate-200 pt-2.5">
                    <SummaryRow
                      label="ยอดสุทธิ (Grand Total)"
                      value={`${formatMoney(grandTotal)} ฿`}
                      emphasize
                    />
                  </div>
                </>
              )}
              {slipUrl && !isSettlementDoc ? (
                <AttachmentSheetViewer
                  fileUrl={slipUrl}
                  title={`สลิปโอนเงิน · ${doc.doc_no}`}
                  trigger={
                    <button
                      type="button"
                      className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
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

        {isReceiptDoc ? (
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
                detailBasePath="/sales"
                statusLabelMode="REC"
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
                detailBasePath="/sales"
                statusLabelMode="REC"
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
                {depositHistoryResult.data.length} รายการที่นำไปตัดชำระผ่าน REC
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              <DepositAllocationHistoryTable
                rows={depositHistoryResult.data}
                receiptBasePath="/sales"
                invoiceBasePath="/sales"
                error={depositHistoryResult.error}
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">รายการสินค้า</CardTitle>
              <CardDescription>
                {doc.items.length} รายการ — แสดงแบบอ่านอย่างเดียว
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      {[
                        "รูปภาพ",
                        "#",
                        "SKU",
                        "รายละเอียด",
                        "จำนวน",
                        "หน่วย",
                        "ราคา/หน่วย",
                        "รวม",
                      ].map((heading) => (
                        <TableHead
                          key={heading}
                          className="px-4 text-xs font-semibold text-slate-500"
                        >
                          {heading}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {doc.items.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="px-4 py-10 text-center text-sm text-slate-400"
                        >
                          ไม่มีรายการสินค้า
                        </TableCell>
                      </TableRow>
                    ) : (
                      doc.items.map((item, index) => (
                        <TableRow key={item.id}>
                          <TableCell className="px-3">
                            <LineItemProductThumb
                              imageUrl={item.image_url}
                              alt={item.sku ?? "สินค้า"}
                            />
                          </TableCell>
                          <TableCell className="px-4 text-xs tabular-nums text-slate-500">
                            {index + 1}
                          </TableCell>
                          <TableCell className="px-4 font-mono text-xs font-semibold text-slate-800">
                            {item.sku ?? "—"}
                          </TableCell>
                          <TableCell className="max-w-[18rem] px-4 text-sm text-slate-700">
                            <span className="line-clamp-2">
                              {item.description || item.product_name || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 text-right text-sm tabular-nums text-slate-700">
                            {item.qty}
                          </TableCell>
                          <TableCell className="px-4 text-xs text-slate-600">
                            {item.uom_used ?? "—"}
                          </TableCell>
                          <TableCell className="px-4 text-right text-sm tabular-nums text-slate-700">
                            {formatMoney(item.unit_price)}
                          </TableCell>
                          <TableCell className="px-4 text-right text-sm font-semibold tabular-nums text-slate-900">
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

        {isReceiptDoc ? (
          <ReferenceDocumentsSection
            documentId={doc.id}
            mode="REC"
            showWhtUpload={
              Number(doc.wht_amount ?? 0) > 0 ||
              allocationsResult.data.some((row) => row.wht_amount > 0)
            }
            whtAttachmentUrl={doc.wht_attachment_url}
            originalReceiptUrl={doc.original_receipt_url}
          />
        ) : null}

        <p className="text-center text-xs text-slate-400">
          ตัวอย่างสำหรับพิมพ์ — กด &quot;พิมพ์เอกสาร&quot; เพื่อสั่งพิมพ์เฉพาะแผ่นนี้
          (ขนาดกระดาษตามประเภทเอกสาร: A4 / A5 Landscape)
        </p>
      </div>

      {/* A4 print layout — preview on screen, sole content when printing */}
      {isReceiptDoc ? (
        <PrintPaymentReceiptTemplate
          document={doc}
          allocations={allocationsResult.data}
          mode="REC"
          className="mt-2 print:mt-0"
        />
      ) : isSettlementDoc ? (
        <PrintSettlementVoucherTemplate
          document={doc}
          allocations={allocationsResult.data}
          detailBasePath="/sales"
          className="mt-2 print:mt-0"
        />
      ) : (
        <PrintDocumentTemplate document={doc} className="mt-2 print:mt-0" />
      )}
    </div>
  );
}
