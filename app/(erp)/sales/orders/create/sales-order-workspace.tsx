"use client";

/**
 * Sales Order create/edit — Client island.
 * Persistence / upload / send-to-production via Server Actions only.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  Factory,
  ImagePlus,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getContactPersons } from "@/lib/actions/document-actions";
import {
  saveSalesOrderDraft,
  sendSalesOrderToProduction,
  uploadSalesOrderMockup,
} from "@/lib/actions/sales-order-actions";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import {
  calculateDocumentSummary,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import { compressImage } from "@/lib/utils/image-compression";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import type {
  ContactPersonOption,
  DocumentDetail,
  SalesProductSearchItem,
} from "@/types/document";
import type {
  SalesOrderLineItem,
  SalesOrderWorkspaceProps,
  SaveSalesOrderDraftInput,
} from "@/types/sales-order";
import ModelMatrixPicker, {
  type ModelMatrixBillItem,
} from "@/components/sales/model-matrix-picker";
import { LineItemProductThumb } from "@/components/sales/LineItemProductThumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Contact } from "@/app/contacts/contacts";
import QuickEditContactButton from "@/components/contacts/QuickEditContactButton";
import ContactPersonCombobox from "@/app/(erp)/sales/create/contact-person-combobox";
import CustomerCombobox from "@/app/(erp)/sales/create/customer-combobox";

const DEFAULT_VAT_RATE = 7;
const INITIAL_VAT_TYPE: VatCalculationType = "EXCLUSIVE";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function calcLineTotal(qty: number, unitPrice: number): number {
  return Math.round(Math.max(0, qty * unitPrice) * 100) / 100;
}

function createLineFromProduct(
  product: SalesProductSearchItem & {
    model_id?: string;
    model_code?: string;
    is_manufactured?: boolean;
  },
  qty = 1,
): SalesOrderLineItem {
  const unitPrice = product.unit_price;
  const nextQty = qty > 0 ? qty : 1;
  return {
    key: `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: product.id,
    sku: product.sku,
    description: product.display_name,
    qty: nextQty,
    uom_used: product.base_uom?.trim() || "ตัว",
    unit_price: unitPrice,
    cost_price: product.cost_price,
    discount_text: "",
    discount_amount: 0,
    line_total: calcLineTotal(nextQty, unitPrice),
    image_url: product.image_url ?? null,
    model_id: product.model_id ?? null,
    model_code: product.model_code ?? null,
    is_manufactured: product.is_manufactured !== false,
  };
}

function linesFromDocument(doc: DocumentDetail): SalesOrderLineItem[] {
  return doc.items.map((item, index) => ({
    key: item.id || `${item.product_id ?? "line"}-${index}`,
    product_id: item.product_id ?? "",
    sku: item.sku ?? "—",
    description: item.description || item.product_name || "",
    qty: Number(item.qty ?? 0),
    uom_used: item.uom_used?.trim() || "ตัว",
    unit_price: Number(item.unit_price ?? 0),
    cost_price: Number(item.unit_cost_price ?? 0),
    discount_text: item.discount_text ?? "",
    discount_amount: Number(item.discount_amount ?? 0),
    line_total: Number(item.line_total ?? 0),
    image_url: item.image_url ?? null,
    model_id: item.model_id ?? null,
    model_code: item.model_code ?? null,
    is_manufactured: item.is_manufactured === true,
  }));
}

function docDateFromDocument(doc: DocumentDetail): string {
  const raw = String(doc.doc_date ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayYmd();
}

export default function SalesOrderWorkspace({
  customers,
  customersError = null,
  document = null,
}: SalesOrderWorkspaceProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [isUploading, startUpload] = useTransition();
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);

  const [documentId, setDocumentId] = useState(document?.id ?? "");
  const [documentNo, setDocumentNo] = useState(document?.doc_no ?? "");
  const [contactId, setContactId] = useState(document?.contact_id ?? "");
  const [contactPersonId, setContactPersonId] = useState(
    document?.contact_person_id ?? "",
  );
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [contactPersons, setContactPersons] = useState<ContactPersonOption[]>(
    [],
  );
  const [isPersonsLoading, setIsPersonsLoading] = useState(false);
  const [docDate, setDocDate] = useState(
    document ? docDateFromDocument(document) : todayYmd(),
  );
  const [notes, setNotes] = useState(document?.notes ?? "");
  const [mockupUrl, setMockupUrl] = useState(
    document?.attachment_url?.trim() ||
      document?.attached_file_url?.trim() ||
      "",
  );
  const [lineItems, setLineItems] = useState<SalesOrderLineItem[]>(
    document ? linesFromDocument(document) : [],
  );
  const [discountText, setDiscountText] = useState(
    document?.discount_text ?? "",
  );
  const [vatType] = useState<VatCalculationType>(
    document?.vat_type ?? INITIAL_VAT_TYPE,
  );

  useEffect(() => {
    setCustomerOptions(customers);
  }, [customers]);

  const billSummary = useMemo(
    () =>
      calculateDocumentSummary({
        lineTotals: lineItems.map((row) => row.line_total),
        discountText,
        vatType,
        vatRate: DEFAULT_VAT_RATE,
      }),
    [lineItems, discountText, vatType],
  );

  const manufacturedCount = useMemo(
    () => lineItems.filter((row) => row.is_manufactured && row.qty > 0).length,
    [lineItems],
  );

  useEffect(() => {
    if (!contactId) {
      setContactPersons([]);
      setContactPersonId("");
      setIsPersonsLoading(false);
      return;
    }

    let active = true;
    setIsPersonsLoading(true);

    void getContactPersons(contactId).then((result) => {
      if (!active) return;
      if (result.error) {
        toast.error(result.error);
        setContactPersons([]);
      } else {
        setContactPersons(result.data);
        setContactPersonId((current) => {
          if (current && result.data.some((person) => person.id === current)) {
            return current;
          }
          return result.data.find((person) => person.is_primary)?.id ?? "";
        });
      }
      setIsPersonsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [contactId]);

  function handleContactMasterSaved(contact: Contact) {
    setCustomerOptions((current) =>
      current.map((row) =>
        row.id === contact.id
          ? { ...row, company_name: contact.company_name }
          : row,
      ),
    );
  }

  function handleAddToBill(items: ModelMatrixBillItem[]) {
    if (items.length === 0) return;
    setLineItems((current) => {
      let next = [...current];
      for (const product of items) {
        const qtyToAdd = product.qty;
        if (!(qtyToAdd > 0)) continue;
        const existingIndex = next.findIndex(
          (row) => row.product_id === product.id,
        );
        if (existingIndex >= 0) {
          const row = next[existingIndex];
          const qty = row.qty + qtyToAdd;
          next[existingIndex] = {
            ...row,
            qty,
            line_total: calcLineTotal(qty, row.unit_price),
          };
        } else {
          next = [...next, createLineFromProduct(product, qtyToAdd)];
        }
      }
      return next;
    });
    toast.success(
      items.length === 1
        ? `เพิ่ม ${items[0].sku} × ${items[0].qty}`
        : `เพิ่ม ${items.length} รายการตามไซส์`,
    );
  }

  function updateLineQty(key: string, qtyRaw: string) {
    const qty = Number.parseFloat(qtyRaw);
    setLineItems((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const nextQty = Number.isFinite(qty) && qty >= 0 ? qty : 0;
        return {
          ...row,
          qty: nextQty,
          line_total: calcLineTotal(nextQty, row.unit_price),
        };
      }),
    );
  }

  function updateLineUnitPrice(key: string, priceRaw: string) {
    const price = Number.parseFloat(priceRaw);
    setLineItems((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const nextPrice = Number.isFinite(price) && price >= 0 ? price : 0;
        return {
          ...row,
          unit_price: nextPrice,
          line_total: calcLineTotal(row.qty, nextPrice),
        };
      }),
    );
  }

  function removeLine(key: string) {
    setLineItems((current) => current.filter((row) => row.key !== key));
  }

  function buildPayload(): SaveSalesOrderDraftInput | null {
    if (!contactId) {
      toast.error("กรุณาเลือกลูกค้า");
      return null;
    }
    if (lineItems.length === 0) {
      toast.error("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
      return null;
    }
    if (lineItems.some((row) => row.qty <= 0)) {
      toast.error("จำนวนสินค้าต้องมากกว่า 0");
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(docDate)) {
      toast.error("กรุณาระบุวันที่เอกสาร");
      return null;
    }

    return {
      document_id: documentId || null,
      contact_id: contactId,
      contact_person_id: contactPersonId || null,
      doc_date: docDate,
      notes: notes.trim() || null,
      mockup_image_url: mockupUrl.trim() || null,
      discount_text: discountText.trim() || null,
      vat_type: vatType,
      vat_rate: DEFAULT_VAT_RATE,
      total_amount: billSummary.total_amount,
      discount_amount: billSummary.discount_amount,
      net_before_vat: billSummary.net_before_vat,
      vat_amount: billSummary.vat_amount,
      grand_total: billSummary.grand_total,
      items: lineItems.map((row, index) => ({
        product_id: row.product_id,
        description: row.description,
        qty: row.qty,
        uom_used: row.uom_used,
        unit_price: row.unit_price,
        unit_cost_price: row.cost_price,
        discount_text: row.discount_text,
        discount_amount: row.discount_amount,
        line_total: row.line_total,
        sort_order: index,
      })),
    };
  }

  function handleSaveDraft() {
    const payload = buildPayload();
    if (!payload) return;

    startTransition(async () => {
      const result = await saveSalesOrderDraft(payload);
      if (!result.success || !result.data) {
        toast.error(result.error ?? "บันทึกร่างไม่สำเร็จ");
        return;
      }
      setDocumentId(result.data.document_id);
      setDocumentNo(result.data.document_no);
      toast.success(`บันทึกร่าง ${result.data.document_no} สำเร็จ`);
      router.replace(
        `/sales/orders/edit/${encodeURIComponent(result.data.document_id)}`,
      );
      router.refresh();
    });
  }

  function handleConfirmSend() {
    const payload = buildPayload();
    if (!payload) return;
    if (manufacturedCount === 0) {
      toast.error(
        "ต้องมีสินค้าที่ผลิตเอง (is_manufactured) อย่างน้อย 1 รายการ",
      );
      return;
    }

    startTransition(async () => {
      const result = await sendSalesOrderToProduction(payload);
      if (result.data?.document_id) {
        setDocumentId(result.data.document_id);
        setDocumentNo(result.data.document_no);
      }
      if (!result.success || !result.data) {
        toast.error(result.error ?? "ส่งงานผลิตไม่สำเร็จ");
        setSendConfirmOpen(false);
        if (result.data?.document_id && result.data.status === "DRAFT") {
          router.replace(
            `/sales/orders/edit/${encodeURIComponent(result.data.document_id)}`,
          );
        }
        return;
      }

      const jobNos = result.data.jobs.map((job) => job.job_no).join(", ");
      toast.success(
        result.data.jobs.length === 0
          ? result.error ?? "ยืนยัน SO แล้ว แต่ยังไม่สร้างใบงาน"
          : `ส่งงานผลิตสำเร็จ (${jobNos})`,
      );
      setSendConfirmOpen(false);
      router.push(`/sales/${encodeURIComponent(result.data.document_no)}`);
      router.refresh();
    });
  }

  function handleMockupSelect(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("กรุณาเลือกไฟล์รูปภาพ (JPG/PNG/WEBP)");
      return;
    }

    startUpload(async () => {
      try {
        const compressed = await compressImage(file);
        const formData = new FormData();
        formData.set("file", compressed);
        if (documentId) formData.set("document_id", documentId);

        const result = await uploadSalesOrderMockup(formData);
        if (!result.success || !result.data) {
          toast.error(result.error ?? "อัปโหลด Mockup ไม่สำเร็จ");
          return;
        }
        setMockupUrl(result.data.url);
        toast.success("อัปโหลด Mockup (WebP) สำเร็จ");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "บีบอัด/อัปโหลดรูปไม่สำเร็จ",
        );
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  const isBusy = isPending || isUploading;
  const isEdit = Boolean(documentId);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-violet-50 text-violet-700">
            <ClipboardList className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {isEdit ? "แก้ไขใบสั่งขาย (SO)" : "สร้างใบสั่งขาย (SO)"}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Phase 17 — ระบุไซส์ (SKU Matrix) แนบ Mockup แล้วส่งเข้า Kanban ผลิต
            </p>
            {documentNo ? (
              <p className="mt-1 font-mono text-xs font-semibold text-violet-700">
                {documentNo}
              </p>
            ) : null}
          </div>
        </div>
        <Link
          href="/sales/orders"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          รายการใบสั่งขาย
        </Link>
      </div>

      {customersError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {customersError}
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ข้อมูลเอกสาร</CardTitle>
          <CardDescription>
            เลือกลูกค้าและวันที่เอกสาร — ระบบรันเลขจริงเมื่อยืนยันส่งผลิต
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="so-customer">ลูกค้า</Label>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <CustomerCombobox
                  options={customerOptions}
                  value={contactId}
                  onChange={setContactId}
                  disabled={isBusy}
                />
              </div>
              {contactId ? (
                <QuickEditContactButton
                  contactId={contactId}
                  onSaved={handleContactMasterSaved}
                />
              ) : null}
            </div>
          </div>
          <div>
            <Label htmlFor="so-person">ผู้ติดต่อ</Label>
            <ContactPersonCombobox
              options={contactPersons}
              value={contactPersonId}
              onChange={setContactPersonId}
              disabled={isBusy || !contactId}
              isLoading={isPersonsLoading}
            />
          </div>
          <div>
            <Label htmlFor="so-date">วันที่เอกสาร</Label>
            <Input
              id="so-date"
              type="date"
              value={docDate}
              disabled={isBusy}
              onChange={(event) => setDocDate(event.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              แสดงผล: {formatThaiDate(docDate, "long")}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="so-notes">หมายเหตุ / รายละเอียดงานผลิต</Label>
            <Textarea
              id="so-notes"
              rows={3}
              disabled={isBusy}
              placeholder="เช่น สกรีนโลโก้หน้าอก / ปักชื่อหลังเสื้อ / สีด้าย..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mockup งานสกรีน / ตัดเย็บ</CardTitle>
          <CardDescription>
            บีบอัดเป็น WebP ≤ 500KB แล้วอัปโหลดเข้า bucket production_attachments
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={isBusy}
            onChange={(event) =>
              handleMockupSelect(event.target.files?.[0])
            }
          />
          {mockupUrl ? (
            <div className="flex flex-wrap items-start gap-4">
              <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mockupUrl}
                  alt="Mockup งานผลิต"
                  className="h-40 w-40 object-cover"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setMockupUrl("")}
                  className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white/90 text-slate-600 shadow hover:text-red-600"
                  aria-label="ลบรูป Mockup"
                >
                  <X className="size-4" />
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <ImagePlus className="mr-1.5 size-4" />
                )}
                เปลี่ยนรูป
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
              className="h-24 w-full border-dashed"
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  กำลังอัปโหลด...
                </>
              ) : (
                <>
                  <ImagePlus className="mr-2 size-4" />
                  เลือกไฟล์รูป Mockup
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">สินค้าผลิตเอง (SKU Matrix)</CardTitle>
          <CardDescription>
            ค้นหารุ่นที่ is_manufactured = true แล้วกรอกจำนวนตามไซส์
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ModelMatrixPicker
            manufacturedOnly
            disabled={isBusy}
            placeholder="ค้นหารุ่นสินค้าที่ผลิตเอง..."
            onAddToBill={handleAddToBill}
          />

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">รูป</TableHead>
                  <TableHead>SKU / รายละเอียด</TableHead>
                  <TableHead className="w-28 text-right">จำนวน</TableHead>
                  <TableHead className="w-32 text-right">ราคา/หน่วย</TableHead>
                  <TableHead className="w-28 text-right">รวม</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-20 text-center text-sm text-slate-500"
                    >
                      ยังไม่มีรายการ — ค้นหารุ่นแล้วกรอกจำนวนตามไซส์
                    </TableCell>
                  </TableRow>
                ) : (
                  lineItems.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <LineItemProductThumb
                          imageUrl={row.image_url}
                          alt={row.sku}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-xs text-slate-500">
                          {row.sku}
                          {row.model_code ? ` · ${row.model_code}` : ""}
                        </p>
                        <p className="text-sm font-medium text-slate-800">
                          {row.description}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          disabled={isBusy}
                          value={row.qty || ""}
                          onChange={(event) =>
                            updateLineQty(row.key, event.target.value)
                          }
                          className="h-9 text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          disabled={isBusy}
                          value={row.unit_price || ""}
                          onChange={(event) =>
                            updateLineUnitPrice(row.key, event.target.value)
                          }
                          className="h-9 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(row.line_total)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isBusy}
                          onClick={() => removeLine(row.key)}
                          aria-label="ลบรายการ"
                        >
                          <Trash2 className="size-4 text-slate-400" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col items-end gap-1 text-sm">
            <div className="flex w-full max-w-xs justify-between text-slate-600">
              <span>รวมก่อนส่วนลด</span>
              <span className="tabular-nums">
                {formatMoney(billSummary.total_amount)}
              </span>
            </div>
            <div className="flex w-full max-w-xs items-center justify-between gap-3 text-slate-600">
              <Label htmlFor="so-discount" className="mb-0">
                ส่วนลดท้ายบิล
              </Label>
              <Input
                id="so-discount"
                disabled={isBusy}
                placeholder="10% หรือ 500"
                value={discountText}
                onChange={(event) => setDiscountText(event.target.value)}
                className="h-8 w-32 text-right"
              />
            </div>
            <div className="flex w-full max-w-xs justify-between text-slate-600">
              <span>VAT 7%</span>
              <span className="tabular-nums">
                {formatMoney(billSummary.vat_amount)}
              </span>
            </div>
            <div className="flex w-full max-w-xs justify-between text-base font-bold text-slate-900">
              <span>ยอดสุทธิ</span>
              <span className="tabular-nums text-violet-700">
                {formatMoney(billSummary.grand_total)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isBusy}
          onClick={handleSaveDraft}
        >
          {isPending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : null}
          {DOCUMENT_ACTIONS.SAVE_DRAFT}
        </Button>
        <Button
          type="button"
          disabled={isBusy || manufacturedCount === 0}
          onClick={() => setSendConfirmOpen(true)}
          className="bg-violet-700 hover:bg-violet-800"
        >
          <Factory className="mr-1.5 size-4" />
          {DOCUMENT_ACTIONS.SEND_TO_PRODUCTION}
        </Button>
      </div>

      <AlertDialog open={sendConfirmOpen} onOpenChange={setSendConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันส่งงานผลิต</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะบันทึกใบสั่งขาย ยืนยันออกเอกสาร (ISSUED) แล้วสร้างใบสั่งผลิต
              พร้อม Snapshot BOM และรายการไซส์อัตโนมัติ
              {mockupUrl ? " รวมแนบรูป Mockup" : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                handleConfirmSend();
              }}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  กำลังส่ง...
                </>
              ) : (
                "ยืนยันส่งงานผลิต"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
