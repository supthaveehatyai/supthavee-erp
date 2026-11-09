"use client";

/**
 * Edit DRAFT sales document — Client island.
 * Persistence via `updateDraftDocument` Server Action only.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, ArrowLeft, Pencil, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { SalesShippingFields } from "@/components/sales/sales-shipping-fields";
import {
  getContactPersons,
  issueDocument,
  searchProductsForSales,
  updateDraftDocument,
} from "@/lib/actions/document-actions";
import { VAT_OPTIONS } from "@/lib/constants/accounting";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import {
  isSalesContactRequired,
  shouldHideSalesContactPicker,
  shouldShowWalkInOptionalFields,
} from "@/lib/constants/document";
import { parseSalesDocumentDraftHeader } from "@/lib/validations/sales-document";
import {
  calculateDocumentSummary,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import { isCancelAndReplaceDraft } from "@/lib/utils/cancel-replace-draft";
import { displayDocumentItemDescription } from "@/lib/utils/credit-note-line";
import { salesBundleDraftFields } from "@/lib/sales/bundle-lines";
import { BundleLineDetails } from "@/components/sales/bundle-line-details";
import { CashReceiptPaymentBox } from "@/components/sales/cash-receipt-payment-box";
import { GoodsQtyBadge } from "@/components/sales/goods-qty-badge";
import {
  bankAccountDisplay,
  initialBankAccountId,
  initialCashReceiptChannel,
  paymentChannelLabel,
  selectedBankAccount,
  type ActiveBankAccount,
  type PaymentChannel,
} from "@/lib/finance/payment-channel";
import { ServiceLineShortcuts } from "@/components/sales/service-line-shortcuts";
import { SalesMockupCard } from "@/components/sales/sales-mockup-card";
import { moneyAfterQtyPrice } from "@/lib/sales/service-line-price";
import type {
  ContactPersonOption,
  CustomerOption,
  DocumentDetail,
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
import ContactPersonCombobox from "../../create/contact-person-combobox";
import CustomerCombobox from "../../create/customer-combobox";
import SalesChannelFields, {
  salesChannelFieldsFromDocument,
  type SalesChannelFieldsValue,
} from "@/components/sales/sales-channel-fields";
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

const INCLUDED_IN_GARMENT_NOTE = "(รวมในราคาเสื้อแล้ว)";

function withIncludedNote(description: string): string {
  if (description.includes("รวมในราคาเสื้อแล้ว")) return description;
  const base = description.trim();
  return base ? `${base} ${INCLUDED_IN_GARMENT_NOTE}` : INCLUDED_IN_GARMENT_NOTE;
}

function withoutIncludedNote(description: string): string {
  return description.replace(/\s*\(รวมในราคาเสื้อแล้ว\)/g, "").replace(/\s+/g, " ").trim();
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
    is_service_item: product.is_service === true,
    is_service: product.is_service === true,
    is_manufactured: product.is_manufactured === true,
    catalog_unit_price: unitPrice,
  };
}

function createServiceLine(): SalesLineItem {
  return {
    key: `service-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: null,
    sku: "SERVICE",
    description: "",
    qty: 1,
    uom_used: "งาน",
    unit_price: 0,
    cost_price: 0,
    discount_text: "",
    discount_amount: 0,
    line_total: 0,
    image_url: null,
    is_service_item: true,
    is_service: true,
    is_manufactured: false,
  };
}

function linesFromDocument(doc: DocumentDetail): SalesLineItem[] {
  const children = new Map<string, DocumentDetail["items"]>();
  for (const item of doc.items) {
    if (!item.is_bundle_component || !item.parent_item_id) continue;
    const list = children.get(item.parent_item_id) ?? [];
    list.push(item);
    children.set(item.parent_item_id, list);
  }
  return doc.items
    .filter((item) => !item.is_bundle_component)
    .map((item, index) => ({
      key: item.id || `${item.product_id ?? "line"}-${index}`,
      product_id: item.product_id,
      sku: item.is_bundle_header ? item.sku || "ชุด" : item.product_id ? item.sku ?? "—" : "SERVICE",
      is_service_item: item.is_bundle_header
        ? false
        : item.is_service_item === true || !item.product_id,
      description: item.is_bundle_header
        ? item.model_short_name || item.description || item.product_name || ""
        : item.description || item.product_name || "",
      qty: Number(item.qty ?? 0),
      uom_used: item.uom_used?.trim() || (item.is_bundle_header ? "ชุด" : "ตัว"),
      unit_price: Number(item.unit_price ?? 0),
      cost_price: Number(item.unit_cost_price ?? 0),
      discount_text: item.discount_text ?? "",
      discount_amount: Number(item.discount_amount ?? 0),
      line_total: Number(item.line_total ?? 0),
      image_url: item.image_url ?? null,
      is_service: item.is_bundle_header
        ? false
        : item.is_service === true || item.is_service_item === true,
      is_manufactured: item.is_manufactured === true,
      catalog_unit_price:
        Number(item.unit_price ?? 0) > 0 ? Number(item.unit_price ?? 0) : undefined,
      bundle_kit_id: item.bundle_kit_id ?? null,
      is_bundle_header: item.is_bundle_header === true,
      bundle_components: (children.get(item.id) ?? []).map((child) => ({
        product_id: child.product_id ?? "",
        sku: child.sku ?? "",
        description: child.description || child.product_name || child.sku || "",
        qty: Number(child.qty ?? 0),
        unit_cost_price: Number(child.unit_cost_price ?? 0),
      })),
    }));
}

export type SalesEditWorkspaceProps = {
  document: DocumentDetail;
  customers: CustomerOption[];
  customersError?: string | null;
  bankAccounts?: ActiveBankAccount[];
};

export default function SalesEditWorkspace({
  document: initialDocument,
  customers,
  customersError = null,
  bankAccounts = [],
}: SalesEditWorkspaceProps) {
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
  const [mockupUrl, setMockupUrl] = useState(
    initialDocument.attachment_url?.trim() ||
      initialDocument.attached_file_url?.trim() ||
      "",
  );
  const [handwrittenDocRef, setHandwrittenDocRef] = useState(
    initialDocument.reference_no ?? "",
  );
  const [docDate, setDocDate] = useState(
    () =>
      (initialDocument.doc_date || "").slice(0, 10) ||
      new Date().toISOString().slice(0, 10),
  );
  const [salesChannelFields, setSalesChannelFields] =
    useState<SalesChannelFieldsValue>(() =>
      salesChannelFieldsFromDocument(initialDocument),
    );
  const [headerOpen, setHeaderOpen] = useState(true);
  const [paymentChannel, setPaymentChannel] = useState<PaymentChannel>(() =>
    initialCashReceiptChannel({
      docType: initialDocument.doc_type,
      salesChannel: initialDocument.sales_channel,
      storedChannel: initialDocument.payment_channel,
    }),
  );
  const [bankAccountId, setBankAccountId] = useState<string | null>(() =>
    initialBankAccountId(
      bankAccounts,
      initialCashReceiptChannel({
        docType: initialDocument.doc_type,
        salesChannel: initialDocument.sales_channel,
        storedChannel: initialDocument.payment_channel,
      }),
      initialDocument.bank_account_id,
      initialDocument.receiving_bank_label,
    ),
  );
  const [slipUrl, setSlipUrl] = useState(initialDocument.original_receipt_url ?? "");
  const [shippingFee, setShippingFee] = useState(
    Number(initialDocument.shipping_fee ?? 0).toFixed(2),
  );
  const [shippingMethod, setShippingMethod] = useState(
    initialDocument.shipping_method ?? "",
  );
  const [isPending, startTransition] = useTransition();
  const preserveInitialPersonRef = useRef(true);
  const isReplacement = isCancelAndReplaceDraft({
    refDocumentId: initialDocument.ref_document_id,
    docType: initialDocument.doc_type,
    notes: initialDocument.notes,
  });
  const hideContactPicker = shouldHideSalesContactPicker({
    docType: initialDocument.doc_type,
    salesChannel: salesChannelFields.sales_channel,
  });
  const contactRequired = isSalesContactRequired({
    docType: initialDocument.doc_type,
    salesChannel: salesChannelFields.sales_channel,
  });
  const selectedCustomerName =
    customerOptions.find((row) => row.id === contactId)?.company_name ??
    initialDocument.contact?.company_name ??
    "";
  const walkInOptional = shouldShowWalkInOptionalFields({
    docType: initialDocument.doc_type,
    salesChannel: salesChannelFields.sales_channel,
  });

  useEffect(() => {
    setCustomerOptions(customers);
  }, [customers]);

  useEffect(() => {
    if (!hideContactPicker) return;
    preserveInitialPersonRef.current = false;
    setContactId("");
    setContactPersonId("");
  }, [hideContactPicker]);

  const billSummary = useMemo(
    () =>
      calculateDocumentSummary({
        lineTotals: lineItems.map((row) => row.line_total),
        discountText,
        vatType,
        vatRate: DEFAULT_VAT_RATE,
        depositGross: Number(initialDocument.deposit_deducted ?? 0),
        depositNet: Number(initialDocument.deposit_net_deducted ?? 0),
        depositVat: Number(initialDocument.deposit_vat_deducted ?? 0),
        shippingFee: Number(shippingFee) || 0,
      }),
    [lineItems, discountText, vatType, initialDocument, shippingFee],
  );
  const needsProductionMockup = useMemo(
    () =>
      lineItems.some(
        (row) =>
          row.is_service_item === true ||
          row.is_service === true ||
          row.is_manufactured === true,
      ),
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

  function handleAddToBill(items: ModelMatrixBillItem[]) {
    if (isReplacement || items.length === 0) return;
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
          const money = moneyAfterQtyPrice({
            qty,
            unitPrice: row.unit_price,
            discountText: row.discount_text,
            discountAmount: row.discount_amount,
          });
          next[existingIndex] = {
            ...row,
            qty,
            ...money,
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

  function handleAddBundleLines(lines: SalesLineItem[]) {
    if (lines.length === 0 || isReplacement) return;
    setLineItems((current) => [...current, ...lines]);
    const kits = lines.reduce((sum, line) => sum + line.qty, 0);
    toast.success(`เพิ่มชุดเซ็ต ${kits} ชุดลงบิลแล้ว`);
  }

  function updateLineQty(key: string, qtyRaw: string) {
    if (isReplacement) return;
    const qty = Number.parseFloat(qtyRaw);
    setLineItems((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const nextQty = Number.isFinite(qty) && qty >= 0 ? qty : 0;
        const money = moneyAfterQtyPrice({
          qty: nextQty,
          unitPrice: row.unit_price,
          discountText: row.discount_text,
          discountAmount: row.discount_amount,
        });
        return {
          ...row,
          qty: nextQty,
          ...money,
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
        const money = moneyAfterQtyPrice({
          qty: row.qty,
          unitPrice: nextPrice,
          discountText: row.discount_text,
          discountAmount: row.discount_amount,
        });
        return {
          ...row,
          unit_price: nextPrice,
          ...money,
        };
      }),
    );
  }

  function includeServiceInGarment(key: string) {
    if (isReplacement) return;
    setLineItems((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const catalog =
          row.unit_price > 0 ? row.unit_price : (row.catalog_unit_price ?? 0);
        return {
          ...row,
          catalog_unit_price: catalog,
          unit_price: 0,
          discount_text: "",
          discount_amount: 0,
          line_total: 0,
          description: withIncludedNote(row.description),
        };
      }),
    );
  }

  function giftServiceLine(key: string) {
    if (isReplacement) return;
    const row = lineItems.find((item) => item.key === key);
    if (!row) return;
    startTransition(async () => {
      let unitPrice = row.unit_price > 0 ? row.unit_price : (row.catalog_unit_price ?? 0);
      if (!(unitPrice > 0) && row.sku && row.sku !== "SERVICE") {
        const found = await searchProductsForSales(row.sku);
        const exact =
          found.data.find((item) => item.id === row.product_id) ??
          found.data.find((item) => item.sku === row.sku);
        if (exact && exact.unit_price > 0) unitPrice = exact.unit_price;
      }
      const gross = calcLineTotal(row.qty, unitPrice);
      setLineItems((current) =>
        current.map((line) =>
          line.key === key
            ? {
                ...line,
                catalog_unit_price: unitPrice,
                unit_price: unitPrice,
                discount_text: "100%",
                discount_amount: gross,
                line_total: 0,
                description: withoutIncludedNote(line.description),
              }
            : line,
        ),
      );
    });
  }

  function removeLine(key: string) {
    if (isReplacement) return;
    setLineItems((current) => current.filter((row) => row.key !== key));
  }

  function handleSave(issueNow = false) {
    if (contactRequired && !contactId) {
      toast.error("กรุณาเลือกลูกค้าก่อนบันทึก");
      return;
    }
    if (!isReplacement) {
      if (lineItems.length === 0) {
        toast.error("กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ");
        return;
      }
      if (lineItems.some((row) => row.qty <= 0)) {
        toast.error("จำนวนสินค้าต้องมากกว่า 0");
        return;
      }
      if (lineItems.some((row) => !row.product_id && !row.description.trim())) {
        toast.error("กรุณาระบุรายละเอียดรายการบริการ");
        return;
      }
    }

    const header = parseSalesDocumentDraftHeader({
      doc_type: initialDocument.doc_type,
      contact_id: hideContactPicker ? null : contactId,
      contact_company_name: selectedCustomerName,
      ...salesChannelFields,
    });
    if (!header.ok) {
      toast.error(header.error);
      return;
    }

    startTransition(async () => {
      const result = await updateDraftDocument({
        document_id: initialDocument.id,
        contact_id: hideContactPicker ? null : contactId,
        contact_person_id: hideContactPicker ? null : contactPersonId || null,
        doc_date: docDate,
        handwritten_doc_ref: handwrittenDocRef.trim() || null,
        discount_text: discountText.trim() || null,
        vat_type: vatType,
        vat_rate: DEFAULT_VAT_RATE,
        notes: notes.trim() || null,
        total_amount: billSummary.total_amount,
        discount_amount: billSummary.discount_amount,
        net_before_vat: billSummary.net_before_vat,
        vat_amount: billSummary.vat_amount,
        grand_total: billSummary.grand_total,
        shipping_fee: Number(shippingFee) || 0,
        shipping_method: shippingMethod || null,
        shipping_tracking_no: initialDocument.shipping_tracking_no ?? null,
        sales_channel: header.data.sales_channel,
        ecommerce_order_no: header.data.ecommerce_order_no,
        ecommerce_buyer_name: header.data.ecommerce_buyer_name,
        tracking_no: header.data.tracking_no,
        one_time_address: header.data.one_time_address,
        attachment_url: mockupUrl.trim() || null,
        ...(initialDocument.doc_type === "ABB" || initialDocument.doc_type === "CS_TAX"
          ? {
              payment_channel: paymentChannel,
              bank_account_id:
                selectedBankAccount(bankAccounts, paymentChannel, bankAccountId)?.id ??
                null,
              receiving_bank_label: (() => {
                const account = selectedBankAccount(
                  bankAccounts,
                  paymentChannel,
                  bankAccountId,
                );
                return account
                  ? bankAccountDisplay(account)
                  : paymentChannelLabel(paymentChannel);
              })(),
              original_receipt_url: slipUrl.trim() || null,
            }
          : {}),
        items: isReplacement
          ? undefined
          : lineItems.map((row, index) => ({
              description: row.description,
              qty: row.qty,
              uom_used: row.uom_used,
              unit_price: row.unit_price,
              unit_cost_price: row.cost_price,
              discount_text: row.discount_text,
              discount_amount: row.discount_amount,
              line_total: row.line_total,
              sort_order: index,
              ...salesBundleDraftFields(row),
            })),
      });

      if (result.error || !result.data) {
        toast.error(result.error ?? "บันทึกเอกสารร่างไม่สำเร็จ");
        return;
      }

      if (issueNow && !isReplacement) {
        const issued = await issueDocument(initialDocument.id);
        if (issued.error || !issued.data) {
          toast.error(
            issued.error ??
              "บันทึกร่างแล้ว แต่ออกเลขบิลไม่สำเร็จ — เปิดร่างเพื่อออกเอกสารต่อ",
          );
          window.location.assign(
            `/sales/${encodeURIComponent(result.data.document_no)}`,
          );
          return;
        }
        toast.success(
          issued.data.successMessage ??
            `ออกบิล ${issued.data.document_no} แล้ว`,
        );
        window.location.assign(
          `/sales/${encodeURIComponent(issued.data.document_no)}`,
        );
        return;
      }

      toast.success(`บันทึกเอกสาร ${result.data.document_no} แล้ว`);
      window.location.assign(
        `/sales/${encodeURIComponent(result.data.document_no)}`,
      );
    });
  }

  const saveDisabled =
    isPending ||
    (contactRequired && !contactId) ||
    (!isReplacement && lineItems.length === 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
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
        {headerOpen ? null : (
          <div className="flex h-11 max-h-11 items-center justify-between gap-3 px-4">
            <p className="truncate text-sm font-medium text-slate-800">
              {initialDocument.doc_type === "ABB"
                ? "ใบเสร็จอย่างย่อ (ABB)"
                : initialDocument.doc_type === "CS_TAX"
                  ? "ใบเสร็จรับเงิน / ใบกำกับภาษี (CS_TAX)"
                  : initialDocument.doc_type}{" "}
              · {docDate.slice(8, 10)}/{docDate.slice(5, 7)}/{docDate.slice(0, 4)} ·{" "}
              {selectedCustomerName || "ยังไม่เลือกลูกค้า"}
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={() => setHeaderOpen(true)}
            >
              🔽 ขยายหัวเอกสาร
            </Button>
          </div>
        )}
        {headerOpen ? (
        <>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">หัวเอกสาร</CardTitle>
            <CardDescription>
              {isReplacement
                ? "โหมดทดแทน — แก้ไขได้เฉพาะลูกค้า ผู้ติดต่อ และหมายเหตุ"
                : `${initialDocument.doc_no} · แก้ไขลูกค้า / รายการ / หมายเหตุได้`}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setHeaderOpen(false)}
            >
              🔼 ย่อหัวเอกสาร
            </Button>
            {!isReplacement ? (
              <Button
                type="button"
                size="sm"
                disabled={saveDisabled}
                className="bg-blue-800 text-white hover:bg-blue-900"
                onClick={() => handleSave(true)}
              >
                ออกบิลทันที
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saveDisabled}
              onClick={() => handleSave(false)}
            >
              บันทึกร่าง
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>ประเภทเอกสาร (doc_type)</Label>
            <Input value={initialDocument.doc_type} disabled readOnly className="h-10" />
          </div>
          <SalesChannelFields
            section="channel"
            value={salesChannelFields}
            onChange={setSalesChannelFields}
            disabled={isPending}
            docType={initialDocument.doc_type}
            contactName={selectedCustomerName}
          />
          <div className="space-y-1.5">
            <Label htmlFor="doc-date">วันที่เอกสาร (doc_date)</Label>
            <Input
              id="doc-date"
              type="date"
              value={docDate}
              disabled={isPending}
              onChange={(event) => setDocDate(event.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handwritten-doc-ref">
              อ้างอิงบิลมือ (handwritten_doc_ref)
            </Label>
            <Input
              id="handwritten-doc-ref"
              value={handwrittenDocRef}
              onChange={(event) => setHandwrittenDocRef(event.target.value)}
              disabled={isPending}
              placeholder="เช่น เล่มที่ 21 เลขที่ 5"
              className="h-10"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>
              ลูกค้า + ชื่อเล่น{" "}
              {walkInOptional ? (
                <span className="font-normal text-slate-500">(ไม่บังคับ)</span>
              ) : null}
            </Label>
            {hideContactPicker ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                ระบบใช้บัญชีลูกค้ากลาง (One-Time Customer / CPD) อัตโนมัติ
              </p>
            ) : (
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
                  onNicknameChange={(id, nickname) => {
                    setCustomerOptions((current) =>
                      current.map((row) =>
                        row.id === id ? { ...row, nickname } : row,
                      ),
                    );
                  }}
                />
              </div>
              <QuickEditContactButton
                contactId={contactId}
                disabled={isPending}
                onSaved={handleContactMasterSaved}
              />
            </div>
            )}
          </div>
          {hideContactPicker ? null : (
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
          )}
          <div className="space-y-1.5">
            <Label htmlFor="notes">หมายเหตุ / ชื่องาน (notes)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={isPending}
              placeholder="เช่น งานสกรีนเสื้อโปโล"
              className="h-10"
            />
          </div>
          <SalesChannelFields
            section="details"
            value={salesChannelFields}
            onChange={setSalesChannelFields}
            disabled={isPending}
            docType={initialDocument.doc_type}
            contactName={selectedCustomerName}
            platformClassName="sm:col-span-4"
          />
        </CardContent>
        </>
        ) : null}
      </Card>

      {needsProductionMockup ? (
        <SalesMockupCard
          url={mockupUrl}
          disabled={isPending}
          onChange={setMockupUrl}
        />
      ) : null}

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
          <GoodsQtyBadge rows={lineItems} className="mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          {!isReplacement ? (
            <div className="flex flex-col gap-3">
              <ModelMatrixPicker
                onAddToBill={handleAddToBill}
                onAddBundleLines={handleAddBundleLines}
                disabled={isPending}
              />
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setLineItems((current) => [...current, createServiceLine()])}
                className="h-9 w-fit"
              >
                + เพิ่มรายการบริการ / ค่าสกรีน / ค่าปัก / กำหนดเอง
              </Button>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                      colSpan={isReplacement ? 8 : 9}
                      className="px-3 py-10 text-center text-sm text-slate-400"
                    >
                      ยังไม่มีรายการสินค้า
                    </TableCell>
                  </TableRow>
                ) : (
                  lineItems.map((row, index) => {
                    const bundleLine = row.is_bundle_header === true;
                    const serviceLine =
                      !bundleLine && (row.is_service_item === true || !row.product_id);
                    return (
                    <TableRow key={row.key}>
                      <TableCell className="px-3">
                        <LineItemProductThumb
                          imageUrl={row.image_url}
                          alt={row.sku}
                        />
                      </TableCell>
                      <TableCell className="px-3 text-xs tabular-nums text-slate-500">
                        {index + 1}
                      </TableCell>
                      <TableCell className="px-3 font-mono text-xs font-semibold">
                        {row.sku}
                      </TableCell>
                      <TableCell className="max-w-[14rem] px-3 text-sm">
                        {!isReplacement && serviceLine ? (
                          <Input
                            value={row.description}
                            disabled={isPending}
                            placeholder="รายละเอียดบริการ"
                            onChange={(event) =>
                              setLineItems((current) =>
                                current.map((line) =>
                                  line.key === row.key
                                    ? { ...line, description: event.target.value }
                                    : line,
                                ),
                              )
                            }
                            className="h-9"
                          />
                        ) : bundleLine ? (
                          <BundleLineDetails
                            description={row.description}
                            components={row.bundle_components}
                          />
                        ) : (
                          displayDocumentItemDescription(row.description)
                        )}
                        {!isReplacement && row.is_service_item ? (
                          <ServiceLineShortcuts
                            disabled={isPending}
                            includedActive={
                              row.unit_price === 0 && row.discount_text.trim() !== "100%"
                            }
                            freeActive={row.discount_text.trim() === "100%"}
                            onIncludeInGarment={() => includeServiceInGarment(row.key)}
                            onFreeGift={() => giftServiceLine(row.key)}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="px-3">
                        {isReplacement ? (
                          <span className="text-sm tabular-nums text-slate-800">
                            {row.qty}
                          </span>
                        ) : bundleLine ? (
                          <span className="text-sm tabular-nums text-slate-800">{row.qty}</span>
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
                        {!isReplacement && serviceLine ? (
                          <Input
                            value={row.uom_used}
                            disabled={isPending}
                            onChange={(event) =>
                              setLineItems((current) =>
                                current.map((line) =>
                                  line.key === row.key
                                    ? { ...line, uom_used: event.target.value }
                                    : line,
                                ),
                              )
                            }
                            className="h-9 w-20"
                          />
                        ) : (
                          row.uom_used
                        )}
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
                        {row.discount_text.trim() === "100%" ? (
                          <span className="mt-0.5 block text-[10px] font-semibold text-emerald-700">
                            ส่วนลด 100% (-{formatMoney(row.discount_amount)} ฿)
                          </span>
                        ) : null}
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
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-4">
            <div className="space-y-3 text-sm text-slate-600">
              <div className="grid gap-3 sm:grid-cols-2">
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
                    placeholder="เช่น 10% หรือ 500"
                    className="h-10"
                  />
                </div>
                <SalesShippingFields
                  fee={shippingFee}
                  method={shippingMethod}
                  disabled={isPending || isReplacement}
                  onFeeChange={setShippingFee}
                  onMethodChange={setShippingMethod}
                />
              </div>
              <GoodsQtyBadge rows={lineItems} />
              {initialDocument.doc_type === "ABB" ||
              initialDocument.doc_type === "CS_TAX" ? (
                <CashReceiptPaymentBox
                  channel={paymentChannel}
                  bankAccountId={bankAccountId}
                  accounts={bankAccounts}
                  referenceNo={handwrittenDocRef}
                  slipUrl={slipUrl}
                  disabled={isPending}
                  onChannelChange={(next, accountId) => {
                    setPaymentChannel(next);
                    setBankAccountId(accountId);
                  }}
                  onReferenceChange={setHandwrittenDocRef}
                  onSlipUrlChange={setSlipUrl}
                  onSlipDate={setDocDate}
                />
              ) : null}
              {billSummary.deposit_deducted > 0 ? (
                <p>
                  หักเงินมัดจำ (รวม VAT):{" "}
                  <span className="font-semibold tabular-nums text-red-600">
                    −{formatMoney(billSummary.deposit_deducted)}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    ฐาน {formatMoney(billSummary.deposit_net_deducted)} + VAT{" "}
                    {formatMoney(billSummary.deposit_vat_deducted)}
                  </span>
                </p>
              ) : null}
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
              {billSummary.shipping_fee > 0 ? (
                <p>
                  ค่าขนส่ง (ไม่คิด VAT / เบิกตามจริง):{" "}
                  <span className="font-semibold tabular-nums text-slate-900">
                    +{formatMoney(billSummary.shipping_fee)}
                  </span>
                </p>
              ) : null}
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
            <div className="flex flex-wrap justify-end gap-2">
              {!isReplacement ? (
                <Button
                  type="button"
                  disabled={saveDisabled}
                  className="h-10 w-auto gap-2 bg-blue-800 px-5 text-white hover:bg-blue-900"
                  onClick={() => handleSave(true)}
                >
                  {isPending ? "กำลังบันทึก..." : "✅ บันทึกและออกบิลขายทันที"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={saveDisabled}
                className="h-10 w-auto gap-2 px-5"
                onClick={() => handleSave(false)}
              >
                <Save className="size-4" />
                {isPending
                  ? "กำลังบันทึก..."
                  : isReplacement
                    ? "บันทึกข้อมูลลูกค้า"
                    : DOCUMENT_ACTIONS.SAVE_DRAFT}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
