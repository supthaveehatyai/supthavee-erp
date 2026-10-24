"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { matchVendorTaxInvoiceAction } from "@/lib/actions/vendor-tax-invoice";
import { uploadProcurementBills } from "@/lib/procurement/upload-bill-files";
import { BillGalleryButton } from "@/components/procurement/bill-gallery-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { roundTaxMoney } from "@/lib/utils/tax-invoice-status";
import type { DocumentStatus, DocumentType, PurchaseDocumentListItem } from "@/types/document";

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

function docTypeLabel(docType: DocumentType): string {
  const labels: Partial<Record<DocumentType, string>> = {
    PO: "ใบสั่งซื้อ",
    AP_TAX: "ใบส่งของ/ใบกำกับ (ตั้งหนี้)",
    AP_INV: "บิลธรรมดา (ตั้งหนี้ Non-VAT)",
    AP_CASH: "บิลเงินสด/ใบกำกับ (จ่ายทันที)",
    TB: "สรุปวางบิลช่าง (Technician Bill)",
    DEP_OUT: "มัดจำจ่าย",
    PAY: "ใบจ่ายชำระ",
    AP_REFUND: "ใบสำคัญรับเงินคืน (Refund Receipt)",
    AP_WRITEOFF: "ใบสำคัญปรับปรุงบัญชี - ตัดเป็นค่าใช้จ่าย (Write-off Expense)",
  };
  return labels[docType] ?? docType;
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
  if (status === "CANCELLED" || status === "VOID") {
    return (
      <Badge className="border-red-200 bg-red-50 text-red-700 hover:bg-red-50">
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant="slate" className="font-semibold">
      {status}
    </Badge>
  );
}

function TaxInvoiceBadge({ doc }: { doc: PurchaseDocumentListItem }) {
  if (doc.tax_invoice_status === "PENDING_TAX_INVOICE") {
    return (
      <span className="mt-1 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800">
        🟠 รอใบกำกับภาษีตัวจริง
      </span>
    );
  }
  if (doc.tax_invoice_status === "TAX_READY" && doc.tax_invoice_no) {
    return (
      <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        🟢 ใบกำกับภาษี: {doc.tax_invoice_no}
      </span>
    );
  }
  if (doc.tax_invoice_status === "CONSOLIDATED_CHILD" && doc.tax_invoice_no) {
    return (
      <span className="mt-1 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
        🔗 รวบในใบกำกับภาษี: {doc.tax_invoice_no}
      </span>
    );
  }
  return null;
}

export function PurchaseTaxMatchTable({
  documents,
  hasActiveFilters,
  error,
}: {
  documents: PurchaseDocumentListItem[];
  hasActiveFilters: boolean;
  error: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [taxNo, setTaxNo] = useState("");
  const [taxDate, setTaxDate] = useState("");
  const [baseInput, setBaseInput] = useState("");
  const [vatInput, setVatInput] = useState("");
  const [adjustAp, setAdjustAp] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const visible = useMemo(
    () =>
      filter === "pending"
        ? documents.filter((doc) => doc.tax_invoice_status === "PENDING_TAX_INVOICE")
        : documents,
    [documents, filter],
  );
  const selected = documents.filter((doc) => selectedIds.includes(doc.id));
  const selectedVendorId = selected[0]?.contact_id ?? null;
  const deliveryTotal = roundTaxMoney(
    selected.reduce((sum, doc) => sum + Number(doc.grand_total || 0), 0),
  );
  const taxBase = roundTaxMoney(Number(baseInput) || 0);
  const taxVat = roundTaxMoney(Number(vatInput) || 0);
  const taxTotal = roundTaxMoney(taxBase + taxVat);
  const variance = roundTaxMoney(taxTotal - deliveryTotal);

  function toggle(doc: PurchaseDocumentListItem) {
    if (doc.tax_invoice_status !== "PENDING_TAX_INVOICE") return;
    setSelectedIds((current) => {
      if (current.includes(doc.id)) return current.filter((id) => id !== doc.id);
      const first = documents.find((item) => item.id === current[0]);
      if (first && first.contact_id !== doc.contact_id) {
        toast.error("เลือกได้เฉพาะใบส่งของผู้จำหน่ายรายเดียวกัน");
        return current;
      }
      return [...current, doc.id];
    });
  }

  function openMatch(ids: string[]) {
    const rows = documents.filter((doc) => ids.includes(doc.id));
    const sum = roundTaxMoney(rows.reduce((total, doc) => total + Number(doc.grand_total || 0), 0));
    const base = roundTaxMoney(sum / 1.07);
    setSelectedIds(ids);
    setTaxNo("");
    setTaxDate("");
    setBaseInput(base.toFixed(2));
    setVatInput(roundTaxMoney(sum - base).toFixed(2));
    setAdjustAp(false);
    setFile(null);
    setOpen(true);
  }

  function submitMatch() {
    startTransition(async () => {
      let fileUrl: string | null = null;
      if (file) {
        const uploaded = await uploadProcurementBills([file], taxNo || "tax-invoice");
        if (uploaded.error || !uploaded.data?.attachment_urls[0]) {
          toast.error(uploaded.error ?? "อัปโหลดใบกำกับภาษีไม่สำเร็จ");
          return;
        }
        fileUrl = uploaded.data.attachment_urls[0];
      }
      const result = await matchVendorTaxInvoiceAction({
        documentIds: selectedIds,
        taxInvoiceNo: taxNo,
        taxInvoiceDate: taxDate,
        actualTaxBase: taxBase,
        actualVatAmount: taxVat,
        taxInvoiceFileUrl: fileUrl,
        adjustApToTaxInvoice: adjustAp,
      });
      if (!result.success) {
        toast.error(result.error ?? "ประกบใบกำกับภาษีไม่สำเร็จ");
        return;
      }
      toast.success("ประกบใบกำกับภาษีตัวจริงแล้ว");
      setOpen(false);
      setSelectedIds([]);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-0">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            filter === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600",
          )}
        >
          ทั้งหมด
        </button>
        <button
          type="button"
          onClick={() => setFilter("pending")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            filter === "pending"
              ? "border-orange-400 bg-orange-50 text-orange-900"
              : "border-slate-200 bg-white text-slate-600",
          )}
        >
          🟠 รอใบกำกับภาษีตัวจริง
        </button>
        <Button
          type="button"
          size="sm"
          disabled={selected.length === 0}
          onClick={() => openMatch(selectedIds)}
          className="ml-auto"
        >
          📎 ประกบใบกำกับภาษีตัวจริง ({selected.length} ใบ)
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead className="whitespace-nowrap">วันที่</TableHead>
              <TableHead className="whitespace-nowrap">เลขที่เอกสาร</TableHead>
              <TableHead className="whitespace-nowrap">ประเภท</TableHead>
              <TableHead>ชื่อซัพพลายเออร์</TableHead>
              <TableHead className="whitespace-nowrap text-right">ยอดสุทธิ</TableHead>
              <TableHead className="whitespace-nowrap">สถานะ</TableHead>
              <TableHead className="whitespace-nowrap text-right">การดำเนินการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-slate-500">
                  {error
                    ? "ไม่สามารถโหลดข้อมูลได้"
                    : filter === "pending"
                      ? "ไม่มีเอกสารที่รอใบกำกับภาษีตัวจริง"
                      : hasActiveFilters
                        ? "ไม่พบเอกสารที่ตรงกับเงื่อนไขการค้นหา"
                        : "ยังไม่มีเอกสารซื้อ — ใช้ «รับสินค้าอัจฉริยะ (OCR)» เพื่อรับของเข้า"}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((doc) => {
                const pending = doc.tax_invoice_status === "PENDING_TAX_INVOICE";
                const checked = selectedIds.includes(doc.id);
                const otherVendor = Boolean(selectedVendorId && selectedVendorId !== doc.contact_id);
                return (
                  <TableRow key={doc.id}>
                    <TableCell>
                      {pending ? (
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={otherVendor && !checked}
                          onChange={() => toggle(doc)}
                          aria-label={`เลือก ${doc.doc_no}`}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-700">
                      {formatDate(doc.doc_date || doc.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-900">
                      <div>{doc.doc_no}</div>
                      {doc.reference_no ? (
                        <div className="mt-0.5 text-xs font-normal text-slate-500">
                          Ref: {doc.reference_no}
                        </div>
                      ) : null}
                      <div>
                        <TaxInvoiceBadge doc={doc} />
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-sm text-slate-700">{docTypeLabel(doc.doc_type)}</span>
                      <span className="ml-1.5 font-mono text-xs text-slate-400">({doc.doc_type})</span>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-slate-700">
                      {doc.vendor_name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-slate-900">
                      {formatMoney(doc.grand_total)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{statusBadge(doc.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-2">
                        {pending ? (
                          <button
                            type="button"
                            onClick={() => openMatch([doc.id])}
                            className="inline-flex h-8 items-center rounded-xl border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-orange-800"
                          >
                            📎 ประกบใบกำกับภาษี
                          </button>
                        ) : null}
                        <BillGalleryButton urls={doc.bill_attachment_urls ?? []} />
                        <Link
                          href={`/purchases/${encodeURIComponent(doc.doc_no)}`}
                          className="inline-flex h-8 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          ดูรายละเอียด
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>ประกบใบกำกับภาษีตัวจริง</DialogTitle>
            <DialogDescription>
              ใบส่งของ {selected.length} ใบ · ยอดรวมใบส่งของ {formatMoney(deliveryTotal)} บาท
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-xs">
            {selected.map((doc) => (
              <li key={doc.id} className="flex justify-between gap-3">
                <span>
                  {doc.doc_no}
                  {doc.reference_no ? ` · Ref ${doc.reference_no}` : ""}
                </span>
                <span className="tabular-nums">{formatMoney(doc.grand_total)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tax-invoice-file">รูปใบกำกับภาษีต้นฉบับ</Label>
              <Input
                id="tax-invoice-file"
                type="file"
                accept="image/*,.pdf"
                disabled={isPending}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tax-invoice-no">เลขที่ใบกำกับภาษีตัวจริง</Label>
                <Input
                  id="tax-invoice-no"
                  value={taxNo}
                  disabled={isPending}
                  placeholder="ORVM26080032"
                  onChange={(event) => setTaxNo(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax-invoice-date">วันที่ใบกำกับภาษีตัวจริง</Label>
                <Input
                  id="tax-invoice-date"
                  type="date"
                  value={taxDate}
                  disabled={isPending}
                  onChange={(event) => setTaxDate(event.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tax-base">ฐานภาษีก่อน VAT ตามใบกำกับภาษีจริง</Label>
                <Input
                  id="tax-base"
                  type="number"
                  step="0.01"
                  value={baseInput}
                  disabled={isPending}
                  onChange={(event) => setBaseInput(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax-vat">ภาษีมูลค่าเพิ่ม 7% ตามใบกำกับภาษีจริง</Label>
                <Input
                  id="tax-vat"
                  type="number"
                  step="0.01"
                  value={vatInput}
                  disabled={isPending}
                  onChange={(event) => setVatInput(event.target.value)}
                />
              </div>
            </div>
            <p className="text-sm text-slate-700">
              ยอดรวมตามใบกำกับภาษี <span className="font-semibold tabular-nums">{formatMoney(taxTotal)}</span> บาท
              {" · "}
              ส่วนต่าง (Variance){" "}
              <span className={cn("font-semibold tabular-nums", variance === 0 ? "text-slate-700" : "text-orange-700")}>
                {variance > 0 ? "+" : ""}
                {formatMoney(variance)} บาท
              </span>
            </p>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={adjustAp}
                disabled={isPending}
                onChange={(event) => setAdjustAp(event.target.checked)}
              />
              <span>
                ปรับยอดเจ้าหนี้รอจ่าย (AP) ให้เท่ากับยอดใบกำกับภาษีจริง ({formatMoney(taxTotal)} บาท)
                {selected[0] ? ` — ส่วนต่างจะถูกบวกเข้า ${selected[0].doc_no}` : ""}
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" disabled={isPending || selected.length === 0} onClick={submitMatch}>
              {isPending ? "กำลังบันทึก..." : "ยืนยันประกบใบกำกับภาษี"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
