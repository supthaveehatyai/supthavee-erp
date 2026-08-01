"use client";

/**
 * Edit DRAFT sales document — Client island.
 * Persistence via `updateDraftDocument` Server Action only.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Pencil, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  getContactPersons,
  updateDraftDocument,
} from "@/lib/actions/document-actions";
import { VAT_OPTIONS } from "@/lib/constants/accounting";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import {
  calculateDocumentSummary,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import type {
  ContactPersonOption,
  CustomerOption,
  DocumentDetail,
  SalesLineItem,
  SalesProductSearchItem,
} from "@/types/document";
import SmartSkuPicker from "@/components/sales/smart-sku-picker";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Contact } from "@/app/contacts/contacts";
import QuickEditContactButton from "@/components/contacts/QuickEditContactButton";
import ContactPersonCombobox from "../../create/contact-person-combobox";
import CustomerCombobox from "../../create/customer-combobox";
import { cn } from "@/lib/utils";

const DEFAULT_VAT_RATE = 7;


function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function calcLineTotal(qty: number, unitPrice: number): number {
  return Math.round(Math.max(0, qty * unitPrice) * 100) / 100;
}

function createLineFromProduct(product: SalesProductSearchItem): SalesLineItem {
  const qty = 1;
  const unitPrice = product.unit_price;
  return {
    key: `${product.id}-${Date.now()}`,
    product_id: product.id,
    sku: product.sku,
    description: product.display_name,
    qty,
    uom_used: product.base_uom?.trim() || "ตัว",
    unit_price: unitPrice,
    cost_price: product.cost_price,
    discount_text: "",
    discount_amount: 0,
    line_total: calcLineTotal(qty, unitPrice),
  };
}

function linesFromDocument(doc: DocumentDetail): SalesLineItem[] {
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
  }));
}

export type SalesEditWorkspaceProps = {
  document: DocumentDetail;
  customers: CustomerOption[];
  customersError?: string | null;
};

export default function SalesEditWorkspace({
  document: initialDocument,
  customers,
  customersError = null,
}: SalesEditWorkspaceProps) {
  const router = useRouter();
  const [contactId, setContactId] = useState(initialDocument.contact_id);
  const [contactPersonId, setContactPersonId] = useState(
    initialDocument.contact_person_id ?? "",
  );
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [contactPersons, setContactPersons] = useState<ContactPersonOption[]>(
    [],
  );
  const [isPersonsLoading, setIsPersonsLoading] = useState(false);
  const [lineItems, setLineItems] = useState<SalesLineItem[]>(() =>
    linesFromDocument(initialDocument),
  );
  const [discountText, setDiscountText] = useState(
    initialDocument.discount_text ?? "",
  );
  const [vatType, setVatType] = useState<VatCalculationType>(
    initialDocument.vat_type === "INCLUSIVE" ||
      initialDocument.vat_type === "NONE" ||
      initialDocument.vat_type === "EXCLUSIVE"
      ? initialDocument.vat_type
      : "EXCLUSIVE",
  );
  const [notes, setNotes] = useState(initialDocument.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const preserveInitialPersonRef = useRef(true);
  const isReplacement = Boolean(initialDocument.ref_document_id);

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

  useEffect(() => {
    if (!contactId) {
      setContactPersons([]);
      setContactPersonId("");
      setIsPersonsLoading(false);
      return;
    }

    let active = true;
    setIsPersonsLoading(true);
    const preservePerson = preserveInitialPersonRef.current;

    void getContactPersons(contactId).then((result) => {
      if (!active) return;
      if (result.error) {
        toast.error(result.error);
        setContactPersons([]);
      } else {
        setContactPersons(result.data);
        if (preservePerson) {
          preserveInitialPersonRef.current = false;
        } else {
          const primary = result.data.find((person) => person.is_primary);
          setContactPersonId(primary?.id ?? "");
        }
      }
      setIsPersonsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [contactId]);

  /** After Quick Edit master-data save — keep draft line items / totals intact. */
  function handleContactMasterSaved(contact: Contact) {
    setCustomerOptions((current) =>
      current.map((row) =>
        row.id === contact.id
          ? { ...row, company_name: contact.company_name }
          : row,
      ),
    );

    void getContactPersons(contact.id).then((result) => {
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setContactPersons(result.data);
      setContactPersonId((current) =>
        result.data.some((person) => person.id === current)
          ? current
          : (result.data.find((person) => person.is_primary)?.id ?? ""),
      );
    });
  }

  function handleSelectProduct(product: SalesProductSearchItem) {
    if (isReplacement) return;
    setLineItems((current) => {
      const existing = current.find((row) => row.product_id === product.id);
      if (existing) {
        return current.map((row) => {
          if (row.product_id !== product.id) return row;
          const qty = row.qty + 1;
          return {
            ...row,
            qty,
            line_total: calcLineTotal(qty, row.unit_price),
          };
        });
      }
      return [...current, createLineFromProduct(product)];
    });
    toast.success(`เพิ่ม ${product.sku} ลงบิลแล้ว`);
  }

  function updateLineQty(key: string, qtyRaw: string) {
    if (isReplacement) return;
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
    if (isReplacement) return;
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
    if (isReplacement) return;
    setLineItems((current) => current.filter((row) => row.key !== key));
  }

  function handleSave() {
    if (!contactId) {
      toast.error("กรุณาเลือกลูกค้าก่อนบันทึก");
      return;
    }
    if (!isReplacement) {
      if (lineItems.length === 0) {
        toast.error("กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ");
        return;
      }
      if (lineItems.some((row) => !row.product_id || row.qty <= 0)) {
        toast.error("รายการสินค้าไม่ครบถ้วน หรือจำนวนต้องมากกว่า 0");
        return;
      }
    }

    startTransition(async () => {
      const result = await updateDraftDocument({
        document_id: initialDocument.id,
        contact_id: contactId,
        contact_person_id: contactPersonId || null,
        doc_date: initialDocument.doc_date || new Date().toISOString().slice(0, 10),
        discount_text: discountText.trim() || null,
        vat_type: vatType,
        vat_rate: DEFAULT_VAT_RATE,
        notes: notes.trim() || null,
        total_amount: billSummary.total_amount,
        discount_amount: billSummary.discount_amount,
        net_before_vat: billSummary.net_before_vat,
        vat_amount: billSummary.vat_amount,
        grand_total: billSummary.grand_total,
        items: isReplacement
          ? undefined
          : lineItems.map((row, index) => ({
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
      });

      if (result.error || !result.data) {
        toast.error(result.error ?? "บันทึกเอกสารร่างไม่สำเร็จ");
        return;
      }

      toast.success(`บันทึกเอกสาร ${result.data.document_no} แล้ว`);
      router.push(`/sales/${encodeURIComponent(result.data.document_no)}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <Pencil className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              แก้ไขเอกสารร่าง
            </h1>
            <p className="mt-0.5 font-mono text-sm text-slate-500">
              {initialDocument.doc_no} · {initialDocument.doc_type}
            </p>
          </div>
        </div>
        <Link
          href={`/sales/${encodeURIComponent(initialDocument.doc_no)}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          กลับหน้ารายละเอียด
        </Link>
      </div>

      {customersError ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          โหลดรายการลูกค้าไม่สำเร็จ: {customersError}
        </p>
      ) : null}

      {isReplacement ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"
        >
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0 text-sm leading-relaxed">
            <p className="font-semibold">เอกสารทดแทน — มาตรฐานกรมสรรพากร</p>
            <p className="mt-1 text-amber-900/90">
              เอกสารนี้เป็นการออกทดแทนตามมาตรฐานสรรพากร: อนุญาตให้แก้ไขข้อมูลลูกค้า
              (ชื่อ, ที่อยู่, เลขผู้เสียภาษี) และหมายเหตุ ไม่อนุญาตให้แก้ไขรายการสินค้าหรือยอดเงิน
              หากยอดเงินผิดพลาด กรุณาใช้ใบลดหนี้ (CN)
            </p>
          </div>
        </div>
      ) : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">หัวเอกสาร</CardTitle>
          <CardDescription>
            {isReplacement
              ? "โหมดทดแทน — แก้ไขได้เฉพาะลูกค้า ผู้ติดต่อ และหมายเหตุ (รายการ/ยอดถูกล็อก)"
              : "ประเภทเอกสารและเลขที่ร่างถูกล็อก — แก้ไขลูกค้า / รายการ / หมายเหตุได้"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>ประเภทเอกสาร</Label>
            <Input value={initialDocument.doc_type} disabled readOnly />
          </div>
          <div className="space-y-1.5">
            <Label>เลขที่เอกสาร</Label>
            <Input value={initialDocument.doc_no} disabled readOnly />
          </div>
          <div className="space-y-1.5">
            <Label>ลูกค้า</Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <CustomerCombobox
                  options={customerOptions}
                  value={contactId}
                  onChange={(next) => {
                    preserveInitialPersonRef.current = false;
                    setContactId(next);
                  }}
                  disabled={isPending || customerOptions.length === 0}
                />
              </div>
              <QuickEditContactButton
                contactId={contactId}
                disabled={isPending}
                onSaved={handleContactMasterSaved}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>ผู้ติดต่อ</Label>
            <ContactPersonCombobox
              options={contactPersons}
              value={contactPersonId}
              onChange={setContactPersonId}
              disabled={isPending || !contactId}
              isLoading={isPersonsLoading}
              placeholder={
                !contactId ? "เลือกลูกค้าก่อน..." : "ค้นหาและเลือกผู้ติดต่อ..."
              }
              emptyMessage={
                contactId
                  ? "ลูกค้ารายนี้ยังไม่มีผู้ติดต่อ"
                  : "เลือกลูกค้าก่อน"
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vat-type">ประเภท VAT</Label>
            <select
              id="vat-type"
              value={vatType}
              onChange={(event) =>
                setVatType(event.target.value as VatCalculationType)
              }
              disabled={isPending || isReplacement}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60"
            >
              {VAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount-text">ส่วนลดท้ายบิล</Label>
            <Input
              id="discount-text"
              value={discountText}
              onChange={(event) => setDiscountText(event.target.value)}
              disabled={isPending || isReplacement}
              placeholder='เช่น 10% หรือ 500'
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="notes">หมายเหตุ / Remark</Label>
            <textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={isPending}
              placeholder="เช่น ออกทดแทนเอกสารเลขที่ ..."
              className="flex w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
            />
          </div>
        </CardContent>
      </Card>

      <Card
        className={cn(
          "border-slate-200 shadow-sm",
          isReplacement && "border-amber-200 bg-amber-50/20",
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-base">รายการสินค้า</CardTitle>
          <CardDescription>
            {isReplacement
              ? "ล็อกตามมาตรฐานสรรพากร — แสดงอย่างเดียว ห้ามเพิ่ม/แก้/ลบ"
              : "เพิ่ม / แก้จำนวน / ราคาได้ก่อนออกเอกสาร"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isReplacement ? (
            <SmartSkuPicker
              onSelectProduct={handleSelectProduct}
              disabled={isPending}
            />
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                  {[
                    "#",
                    "SKU",
                    "รายละเอียด",
                    "จำนวน",
                    "หน่วย",
                    "ราคา/หน่วย",
                    "รวม",
                    ...(isReplacement ? [] : [""]),
                  ].map((heading) => (
                    <TableHead
                      key={heading || "actions"}
                      className="px-3 text-xs font-semibold text-slate-500"
                    >
                      {heading}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={isReplacement ? 7 : 8}
                      className="px-3 py-10 text-center text-sm text-slate-400"
                    >
                      ยังไม่มีรายการสินค้า
                    </TableCell>
                  </TableRow>
                ) : (
                  lineItems.map((row, index) => (
                    <TableRow key={row.key}>
                      <TableCell className="px-3 text-xs tabular-nums text-slate-500">
                        {index + 1}
                      </TableCell>
                      <TableCell className="px-3 font-mono text-xs font-semibold">
                        {row.sku}
                      </TableCell>
                      <TableCell className="max-w-[14rem] px-3 text-sm">
                        {row.description}
                      </TableCell>
                      <TableCell className="px-3">
                        {isReplacement ? (
                          <span className="text-sm tabular-nums text-slate-800">
                            {row.qty}
                          </span>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={row.qty}
                            onChange={(event) =>
                              updateLineQty(row.key, event.target.value)
                            }
                            disabled={isPending}
                            className="h-9 w-24"
                          />
                        )}
                      </TableCell>
                      <TableCell className="px-3 text-xs text-slate-600">
                        {row.uom_used}
                      </TableCell>
                      <TableCell className="px-3">
                        {isReplacement ? (
                          <span className="text-sm tabular-nums text-slate-800">
                            {formatMoney(row.unit_price)}
                          </span>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={row.unit_price}
                            onChange={(event) =>
                              updateLineUnitPrice(row.key, event.target.value)
                            }
                            disabled={isPending}
                            className="h-9 w-28"
                          />
                        )}
                      </TableCell>
                      <TableCell className="px-3 text-right text-sm font-semibold tabular-nums">
                        {formatMoney(row.line_total)}
                      </TableCell>
                      {!isReplacement ? (
                        <TableCell className="px-3">
                          <button
                            type="button"
                            onClick={() => removeLine(row.key)}
                            disabled={isPending}
                            className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            aria-label="ลบรายการ"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-4">
            <div className="space-y-1 text-sm text-slate-600">
              <p>
                ยอดก่อนภาษี:{" "}
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatMoney(
                    isReplacement
                      ? Number(initialDocument.net_before_vat ?? billSummary.net_before_vat)
                      : billSummary.net_before_vat,
                  )}
                </span>
              </p>
              <p>
                VAT:{" "}
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatMoney(
                    isReplacement
                      ? Number(initialDocument.vat_amount ?? billSummary.vat_amount)
                      : billSummary.vat_amount,
                  )}
                </span>
              </p>
              <p>
                รวมสุทธิ:{" "}
                <span className="text-base font-bold tabular-nums text-blue-700">
                  {formatMoney(
                    isReplacement
                      ? Number(initialDocument.grand_total ?? billSummary.grand_total)
                      : billSummary.grand_total,
                  )}
                </span>
              </p>
            </div>
            <Button
              type="button"
              disabled={
                isPending ||
                !contactId ||
                (!isReplacement && lineItems.length === 0)
              }
              className="h-10 gap-2"
              onClick={handleSave}
            >
              <Save className="size-4" />
              {isPending
                ? "กำลังบันทึก..."
                : isReplacement
                  ? "บันทึกข้อมูลลูกค้า"
                  : DOCUMENT_ACTIONS.SAVE_DRAFT}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
