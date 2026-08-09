"use client";

/**
 * Sales Create workspace — Client island under a Server Component page.
 *
 * Owns interactive state for the fixed header (`doc_type`, `contact_id`,
 * `contact_person_id`), Model-First Matrix line items, and draft document.
 * Persistence / lookups go through Server Actions only — never client Supabase.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createDraftDocument,
  getContactPersons,
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
  DocumentType,
  SalesLineItem,
  SalesProductSearchItem,
} from "@/types/document";
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
import ContactPersonCombobox from "./contact-person-combobox";
import CustomerCombobox from "./customer-combobox";

const INITIAL_DOC_TYPE: DocumentType = "TAX_INV";
const INITIAL_VAT_TYPE: VatCalculationType = "EXCLUSIVE";
const DEFAULT_VAT_RATE = 7;


const SALES_DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: "QT", label: "ใบเสนอราคา (QT)" },
  { value: "SO", label: "ใบสั่งขาย (SO)" },
  { value: "ABB", label: "ใบเสร็จอย่างย่อ (ABB)" },
  { value: "DEP_IN", label: "ใบมัดจำรับ (DEP_IN)" },
  { value: "INV_DO", label: "ใบส่งของ / แจ้งหนี้ (INV_DO)" },
  { value: "TAX_INV", label: "ใบกำกับภาษี (TAX_INV)" },
  { value: "CS_TAX", label: "ใบกำกับเงินสด (CS_TAX)" },
  { value: "REC", label: "ใบเสร็จรับเงิน (REC)" },
  { value: "CN", label: "ใบลดหนี้ (CN)" },
];

const ITEM_COLUMNS = [
  "รูปภาพ",
  "#",
  "SKU",
  "รายละเอียด",
  "จำนวน",
  "หน่วย",
  "ราคา/หน่วย",
  "ส่วนลด",
  "รวม",
  "",
] as const;

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function calcLineTotal(qty: number, unitPrice: number): number {
  const raw = qty * unitPrice;
  return Math.round(Math.max(0, raw) * 100) / 100;
}

function createLineFromProduct(
  product: SalesProductSearchItem,
  qty = 1,
): SalesLineItem {
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
  };
}

export type SalesCreateWorkspaceProps = {
  customers: CustomerOption[];
  customersError?: string | null;
};

export default function SalesCreateWorkspace({
  customers,
  customersError = null,
}: SalesCreateWorkspaceProps) {
  const router = useRouter();
  const [docType, setDocType] = useState<DocumentType>(INITIAL_DOC_TYPE);
  const [contactId, setContactId] = useState("");
  const [contactPersonId, setContactPersonId] = useState("");
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [contactPersons, setContactPersons] = useState<ContactPersonOption[]>(
    [],
  );
  const [isPersonsLoading, setIsPersonsLoading] = useState(false);
  const [lastSavedDocNo, setLastSavedDocNo] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<SalesLineItem[]>([]);
  const [discountText, setDiscountText] = useState("");
  const [vatType, setVatType] = useState<VatCalculationType>(INITIAL_VAT_TYPE);
  const [isPending, startTransition] = useTransition();

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
    setContactPersonId("");
    setContactPersons([]);

    void getContactPersons(contactId).then((result) => {
      if (!active) return;
      if (result.error) {
        toast.error(result.error);
        setContactPersons([]);
      } else {
        setContactPersons(result.data);
        const primary = result.data.find((person) => person.is_primary);
        if (primary) setContactPersonId(primary.id);
      }
      setIsPersonsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [contactId]);

  /** After Quick Edit master-data save — keep draft form state intact. */
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

  /** Hide "ล่าสุด: …" as soon as the user starts a new draft. */
  function clearLastSavedArtifact() {
    setLastSavedDocNo(null);
  }

  /** Full hard reset to initial blank form (after successful save). */
  function resetFormToInitial() {
    setDocType(INITIAL_DOC_TYPE);
    setContactId("");
    setContactPersonId("");
    setContactPersons([]);
    setIsPersonsLoading(false);
    setLineItems([]);
    setDiscountText("");
    setVatType(INITIAL_VAT_TYPE);
  }

  function handleDocTypeChange(next: DocumentType) {
    clearLastSavedArtifact();
    setDocType(next);
  }

  function handleCustomerChange(nextContactId: string) {
    clearLastSavedArtifact();
    setContactId(nextContactId);
  }

  function handleContactPersonChange(nextPersonId: string) {
    clearLastSavedArtifact();
    setContactPersonId(nextPersonId);
  }

  function handleAddToBill(items: ModelMatrixBillItem[]) {
    if (items.length === 0) return;
    clearLastSavedArtifact();
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
        ? `เพิ่ม ${items[0].sku} × ${items[0].qty} ลงบิลแล้ว`
        : `เพิ่ม ${items.length} รายการลงบิลแล้ว`,
    );
  }

  function updateLineQty(key: string, qtyRaw: string) {
    clearLastSavedArtifact();
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
    clearLastSavedArtifact();
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
    clearLastSavedArtifact();
    setLineItems((current) => current.filter((row) => row.key !== key));
  }

  function handleCreateDraft() {
    if (!contactId) {
      toast.error("กรุณาเลือกลูกค้าก่อนสร้างเอกสาร");
      return;
    }
    if (lineItems.length === 0) {
      toast.error("กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ");
      return;
    }
    if (lineItems.some((row) => row.qty <= 0)) {
      toast.error("จำนวนสินค้าต้องมากกว่า 0");
      return;
    }

    startTransition(async () => {
      const result = await createDraftDocument({
        doc_type: docType,
        contact_id: contactId,
        contact_person_id: contactPersonId || null,
        doc_date: new Date().toISOString().slice(0, 10),
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
      });

      if (result.error || !result.data) {
        toast.error(result.error ?? "สร้างเอกสารไม่สำเร็จ");
        return;
      }

      const docNo = result.data.document_no;
      toast.success(`สร้างเอกสาร ${docNo} สำเร็จ`);

      // 1) Show success artifact briefly
      setLastSavedDocNo(docNo);
      // 2) Hard-reset all draft form state so nothing sticks
      resetFormToInitial();
      // 3) Invalidate Next.js client cache / re-fetch server props
      router.refresh();
      // 4) Open read-only document view for issue / complete flow
      router.push(`/sales/${encodeURIComponent(docNo)}`);
    });
  }

  const linesSubtotal = billSummary.total_amount;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <Receipt className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              เปิดบิลขาย
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Phase 4 — Smart SKU Picker + Line Items (Server Actions only)
            </p>
          </div>
        </div>
        {lastSavedDocNo && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            ล่าสุด: {lastSavedDocNo}
          </span>
        )}
      </div>

      {customersError && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          โหลดรายการลูกค้าไม่สำเร็จ: {customersError}
        </p>
      )}

      <Card className="sticky top-0 z-10 border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">หัวเอกสาร</CardTitle>
          <CardDescription>
            <code className="text-[11px]">doc_type</code> ·{" "}
            <code className="text-[11px]">contact_id</code> ·{" "}
            <code className="text-[11px]">contact_person_id</code> — เลขที่บิล
            PREFIX-YYMM-XXXX
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreateDraft();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="doc-type">ประเภทเอกสาร (doc_type)</Label>
              <select
                id="doc-type"
                name="doc_type"
                value={docType}
                onChange={(event) =>
                  handleDocTypeChange(event.target.value as DocumentType)
                }
                disabled={isPending}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-white focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {SALES_DOC_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>ลูกค้า (contact_id)</Label>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <CustomerCombobox
                    options={customerOptions}
                    value={contactId}
                    onChange={handleCustomerChange}
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
              <Label>ผู้ติดต่อ (contact_person_id)</Label>
              <ContactPersonCombobox
                options={contactPersons}
                value={contactPersonId}
                onChange={handleContactPersonChange}
                disabled={isPending || !contactId}
                isLoading={isPersonsLoading}
                placeholder={
                  !contactId
                    ? "เลือกลูกค้าก่อน..."
                    : "ค้นหาและเลือกผู้ติดต่อ..."
                }
                emptyMessage={
                  contactId
                    ? "ลูกค้ารายนี้ยังไม่มีผู้ติดต่อ"
                    : "เลือกลูกค้าก่อน"
                }
              />
            </div>

            <div className="flex items-end">
              <Button
                type="submit"
                disabled={
                  isPending || !contactId || lineItems.length === 0
                }
                className="h-10 w-full gap-2"
              >
                <FilePlus2 className="size-4" />
                {isPending ? "กำลังบันทึก..." : DOCUMENT_ACTIONS.SAVE_DRAFT}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ค้นหารุ่นสินค้าลงบิล</CardTitle>
          <CardDescription>
            Model-First — ค้นหารุ่น แล้วเลือกสี/ไซส์/จำนวนจาก Matrix (รวม = จำนวน ×
            ราคา/หน่วย)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModelMatrixPicker
            disabled={isPending}
            onAddToBill={handleAddToBill}
          />
          <p className="mt-2 text-[11px] text-slate-500">
            เพิ่มจาก Matrix แล้วปรับราคา/จำนวนในตารางได้ — กด &quot;
            {DOCUMENT_ACTIONS.SAVE_DRAFT}&quot; เพื่อรันเลขที่บิล + บันทึก
          </p>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base">รายการสินค้า</CardTitle>
            <CardDescription>
              {lineItems.length > 0
                ? `${lineItems.length} รายการ · รวม ${formatMoney(linesSubtotal)} ฿`
                : "เลือกรุ่นสินค้าจาก Model Matrix เพื่อเพิ่มลงบิล"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                  {ITEM_COLUMNS.map((heading) => (
                    <TableHead
                      key={heading || "actions"}
                      className="px-4 text-xs font-semibold text-slate-500"
                    >
                      {heading}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={ITEM_COLUMNS.length}
                      className="px-4 py-12 text-center text-sm text-slate-400"
                    >
                      ยังไม่มีรายการสินค้า
                    </TableCell>
                  </TableRow>
                ) : (
                  lineItems.map((row, index) => (
                    <TableRow key={row.key}>
                      <TableCell className="px-3">
                        <LineItemProductThumb
                          imageUrl={row.image_url}
                          alt={row.sku}
                        />
                      </TableCell>
                      <TableCell className="px-4 text-xs tabular-nums text-slate-500">
                        {index + 1}
                      </TableCell>
                      <TableCell className="px-4 font-mono text-xs font-semibold text-slate-800">
                        {row.sku}
                      </TableCell>
                      <TableCell className="max-w-[16rem] px-4 text-sm text-slate-700">
                        <span className="line-clamp-2">{row.description}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-400">
                          ต้นทุน snapshot {formatMoney(row.cost_price)} ฿
                        </span>
                      </TableCell>
                      <TableCell className="px-4">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={row.qty}
                          disabled={isPending}
                          onChange={(event) =>
                            updateLineQty(row.key, event.target.value)
                          }
                          className="h-8 w-20 tabular-nums"
                          aria-label={`จำนวน ${row.sku}`}
                        />
                      </TableCell>
                      <TableCell className="px-4 text-xs text-slate-600">
                        {row.uom_used}
                      </TableCell>
                      <TableCell className="px-4">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.unit_price}
                          disabled={isPending}
                          onChange={(event) =>
                            updateLineUnitPrice(row.key, event.target.value)
                          }
                          className="h-8 w-28 text-right tabular-nums"
                          aria-label={`ราคาต่อหน่วย ${row.sku}`}
                        />
                      </TableCell>
                      <TableCell className="px-4 text-right text-xs tabular-nums text-slate-500">
                        {row.discount_amount > 0
                          ? formatMoney(row.discount_amount)
                          : "—"}
                      </TableCell>
                      <TableCell className="px-4 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {formatMoney(row.line_total)}
                      </TableCell>
                      <TableCell className="px-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`ลบ ${row.sku}`}
                          disabled={isPending}
                          onClick={() => removeLine(row.key)}
                          className="size-8 text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">สรุปยอดเงิน</CardTitle>
          <CardDescription>
            ส่วนลดท้ายบิล + VAT คำนวณแบบ Real-time ตามประเภทภาษี
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="vat-type">ประเภท VAT (vat_type)</Label>
                <select
                  id="vat-type"
                  value={vatType}
                  disabled={isPending}
                  onChange={(event) => {
                    clearLastSavedArtifact();
                    setVatType(event.target.value as VatCalculationType);
                  }}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60"
                >
                  {VAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bill-discount">
                  ส่วนลดท้ายบิล (เช่น 10% หรือ 500)
                </Label>
                <Input
                  id="bill-discount"
                  value={discountText}
                  disabled={isPending}
                  placeholder="ว่าง = ไม่มีส่วนลด"
                  onChange={(event) => {
                    clearLastSavedArtifact();
                    setDiscountText(event.target.value);
                  }}
                  className="h-10"
                />
                <p className="text-[11px] text-slate-400">
                  ใส่ % สำหรับเปอร์เซ็นต์ หรือตัวเลขล้วนสำหรับจำนวนเงินบาท
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">ยอดรวมสินค้า (Subtotal)</dt>
                  <dd className="font-medium tabular-nums text-slate-800">
                    {formatMoney(billSummary.total_amount)} ฿
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">
                    ส่วนลดท้ายบิล
                    {discountText.trim() ? (
                      <span className="ml-1 text-[11px] text-slate-400">
                        ({discountText.trim()})
                      </span>
                    ) : null}
                  </dt>
                  <dd className="font-medium tabular-nums text-red-600">
                    −{formatMoney(billSummary.discount_amount)} ฿
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2.5">
                  <dt className="text-slate-600">
                    ยอดหลังหักส่วนลด (Net Before VAT)
                  </dt>
                  <dd className="font-semibold tabular-nums text-slate-900">
                    {formatMoney(billSummary.net_before_vat)} ฿
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">
                    ภาษีมูลค่าเพิ่ม {DEFAULT_VAT_RATE}%
                    <span className="ml-1 text-[10px] uppercase text-slate-400">
                      {vatType}
                    </span>
                  </dt>
                  <dd className="font-medium tabular-nums text-slate-800">
                    {formatMoney(billSummary.vat_amount)} ฿
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-300 pt-3">
                  <dt className="text-base font-bold text-slate-900">
                    ยอดสุทธิ (Grand Total)
                  </dt>
                  <dd className="text-lg font-bold tabular-nums text-blue-700">
                    {formatMoney(billSummary.grand_total)} ฿
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
