"use client";

/**
 * Phase 8 — Expense create workspace (Client island for Tabs + form state).
 * Categories / vendors / bank accounts come from Server Component parent.
 * OCR ส่งรูปที่บีบอัดแล้วไป `POST /api/expenses/ocr` (Gemini โดยตรง)
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Sparkles,
  PenLine,
  ScanLine,
  Trash2,
  Paperclip,
  X,
  FileText,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  createDraftExpense,
  updateDraftExpense,
} from "@/app/actions/expenses";
import { getOcrQuotaStatusAction } from "@/lib/actions/receipt";
import {
  formatOcrQuotaChip,
  type OcrQuotaStatus,
} from "@/lib/ai/ocr-quota";
import {
  DUPLICATE_INVOICE_ERROR,
  DUPLICATE_INVOICE_MESSAGE,
} from "@/lib/constants/expense-constants";
import type {
  ExpenseBankAccountOption,
  ExpenseCategory,
  ExpenseVendorOption,
} from "@/types/expense";
import type { MstWhtRate } from "@/types/wht-rate";
import type { ExpenseOcrScan } from "@/types/expense";
import VendorCombobox from "@/components/procurement/VendorCombobox";
import { Badge } from "@/components/ui/badge";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type VatOptionValue } from "@/lib/constants/accounting";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/utils/image-compression";
import { ExpenseCategoryCombobox } from "./expense-category-combobox";

export type ExpenseCreateTab = "ocr" | "manual";

export type ExpenseVatType = VatOptionValue;

const EXPENSE_VAT_OPTIONS: { value: ExpenseVatType; label: string }[] = [
  { value: "INCLUSIVE", label: "ราคารวม VAT 7% (Inclusive VAT)" },
  { value: "EXCLUSIVE", label: "ราคาแยก VAT 7% (Exclusive VAT)" },
  { value: "NONE", label: "ไม่มี VAT (noVAT)" },
];

const TAX_TIER_OPTIONS = [
  { value: "CORP_VAT", label: "1.1 มีใบกำกับภาษี VAT" },
  { value: "RECEIPT_1_2", label: "1.2 ใบรับเงินแนบบัตร ปชช." },
  { value: "INTERNAL_1_3", label: "1.3 บิลภายใน noVAT" },
] as const;

export type ExpenseFormInitialValues = {
  expense_date: string;
  vendor_id: string | null;
  category_id: string | null;
  net_amount: number;
  vat_amount: number;
  grand_total: number;
  wht_type?: string | null;
  wht_rate?: number;
  wht_amount?: number;
  net_payable?: number;
  payment_method: string | null;
  bank_account_id: string | null;
  remark: string | null;
  receipt_url?: string | null;
  /** Optional bank transfer slip → expenses.payment_slip_url */
  payment_slip_url?: string | null;
  /** Vendor bill number → expenses.vendor_doc_no */
  vendor_doc_no?: string | null;
  is_installment?: boolean;
  installments?: ExpenseInstallmentFormRow[];
};

export type ExpenseCreateWorkspaceProps = {
  categories: ExpenseCategory[];
  categoriesError?: string | null;
  vendors: ExpenseVendorOption[];
  vendorsError?: string | null;
  bankAccounts: ExpenseBankAccountOption[];
  bankAccountsError?: string | null;
  defaultDate: string;
  defaultTab?: ExpenseCreateTab;
  /** จาก system_parameters.WHT_RATE (Server Component) — fallback เมื่อไม่มี master match */
  defaultWhtRate: number;
  /** Active rows จาก mst_wht_rates (Server Component) */
  whtRates: MstWhtRate[];
  whtRatesError?: string | null;
  /** When set, form updates an existing DRAFT instead of creating. */
  mode?: "create" | "edit";
  expenseId?: string;
  documentNo?: string;
  initialValues?: ExpenseFormInitialValues;
};

type PaymentMethod = "CASH" | "TRANSFER";

type ExpenseFormItem = {
  description: string;
  amount: number;
  category_hint: string;
};

type ExpenseInstallmentFormRow = {
  installment_period: number;
  due_date: string;
  principal_amount: number;
  interest_amount: number;
};

/** RHF form shape — includes OCR-mapped fields + save payload fields. */
export type ExpenseFormValues = {
  expense_date: string;
  vendor_id: string;
  vendor_name: string;
  vendor_tax_id: string;
  accounting_tax_tier: "CORP_VAT" | "RECEIPT_1_2" | "INTERNAL_1_3";
  reference_no: string;
  vehicle_plate: string;
  document_number: string;
  document_date: string;
  category_id: string;
  vat_type: ExpenseVatType;
  sub_total: number;
  vat_amount: number;
  grand_total: number;
  /** WHT category label → expenses.wht_type (empty = None) */
  wht_type: string;
  /** WHT rate percent → expenses.wht_rate */
  wht_rate: number;
  /** Auto: sub_total × (wht_rate / 100) */
  wht_amount: number;
  /** Auto: grand_total − wht_amount (cash to transfer) */
  net_payable: number;
  /** Editable base input driving VAT math (string for controlled number input). */
  base_amount: string;
  payment_method: PaymentMethod;
  bank_account_id: string;
  remark: string;
  items: ExpenseFormItem[];
  /** Local File held in RHF until submit → uploadExpenseReceipt → receipt_url */
  attachment_file: File | null;
  /** Existing / uploaded public URL stored in expenses.receipt_url */
  receipt_url: string;
  /** Local File held until submit → payment_slip_url (optional) */
  payment_slip_file: File | null;
  /** Existing / uploaded public URL stored in expenses.payment_slip_url */
  payment_slip_url: string;
  is_installment: boolean;
  installments: ExpenseInstallmentFormRow[];
};

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "เงินสด (Cash)" },
  { value: "TRANSFER", label: "โอนเงิน (Transfer)" },
];

const CATEGORY_HINT_TO_NAMES: Record<string, string[]> = {
  FUEL_TRANSPORT: ["ค่าน้ำมันเชื้อเพลิงและยานพาหนะ", "ค่าขนส่งและเดินทาง", "ค่าขนส่ง"],
  TRANSPORT: ["ค่าขนส่งและเดินทาง", "ค่าขนส่ง"],
  UTILITIES: ["ค่าสาธารณูปโภค", "ค่าน้ำ-ไฟ", "ค่าน้ำ", "ค่าไฟ"],
  OFFICE_SUPPLIES: ["ค่าวัสดุสิ้นเปลือง"],
  OFFICE_SUPPLY: ["ค่าวัสดุสิ้นเปลือง"],
  REPAIR_MAINTENANCE: ["ค่าซ่อมแซมและบำรุงรักษา"],
  MAINTENANCE: ["ค่าซ่อมแซมและบำรุงรักษา", "ค่าใช้จ่ายสำนักงาน"],
  SALARY: ["ค่าจ้างและเงินเดือน", "เงินเดือน"],
  OTHER: ["ค่าใช้จ่ายเบ็ดเตล็ด", "อื่นๆ"],
};

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeDefaultWhtRate(value: number): number {
  const n = roundMoney(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return 3;
  return n;
}

function resolveEffectiveWhtRate(
  whtType: string | null | undefined,
  whtRate: number | null | undefined,
  defaultWhtRate: number,
): number {
  if (!String(whtType ?? "").trim()) return 0;
  const rate = roundMoney(Number(whtRate ?? 0));
  if (Number.isFinite(rate) && rate > 0) return rate;
  return normalizeDefaultWhtRate(defaultWhtRate);
}

function parseAmount(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Split Net Payable into N principals; remainder (decimal leakage) → last row. */
function splitPrincipalAcrossInstallments(
  netPayable: number,
  count: number,
): number[] {
  if (count <= 0) return [];
  const total = roundMoney(Math.max(0, netPayable));
  if (count === 1) return [total];

  const baseCents = Math.floor(Math.round(total * 100) / count);
  const amounts = Array.from({ length: count }, () =>
    roundMoney(baseCents / 100),
  );
  const allocated = roundMoney(amounts.slice(0, -1).reduce((s, v) => s + v, 0));
  amounts[count - 1] = roundMoney(total - allocated);
  return amounts;
}

function moneyEquals(a: number, b: number, eps = 0.005): boolean {
  return Math.abs(roundMoney(a) - roundMoney(b)) <= eps;
}

/** Infer VAT type from stored net/vat/grand (expenses table has no vat_type column). */
export function inferExpenseVatType(
  netAmount: number,
  vatAmount: number,
  grandTotal: number,
): ExpenseVatType {
  const net = roundMoney(netAmount);
  const vat = roundMoney(vatAmount);
  const grand = roundMoney(grandTotal);

  if (vat <= 0.005) return "NONE";

  const exclusiveVat = roundMoney(net * 0.07);
  if (Math.abs(exclusiveVat - vat) <= 0.02) return "EXCLUSIVE";

  const inclusiveVat = roundMoney((grand * 7) / 107);
  if (Math.abs(inclusiveVat - vat) <= 0.02) return "INCLUSIVE";

  return "EXCLUSIVE";
}

function resolveBaseAmountInput(
  values: ExpenseFormInitialValues,
  vatType: ExpenseVatType,
): string {
  if (vatType === "INCLUSIVE") {
    return String(roundMoney(values.grand_total));
  }
  return String(roundMoney(values.net_amount));
}

function resolvePaymentMethod(
  raw: string | null | undefined,
): PaymentMethod {
  return raw?.trim().toUpperCase() === "TRANSFER" ? "TRANSFER" : "CASH";
}

function formatWhtRatePercent(rate: number): string {
  const rounded = roundMoney(rate);
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
}

function formatWhtOptionLabel(name: string, rate: number): string {
  return `${name} (${formatWhtRatePercent(rate)}%)`;
}

type ExpenseWhtDropdownOption = {
  value: string;
  label: string;
  rate: number;
};

function buildWhtDropdownOptions(
  whtRates: MstWhtRate[],
  legacyType?: string | null,
  legacyRate?: number | null,
): ExpenseWhtDropdownOption[] {
  const options: ExpenseWhtDropdownOption[] = whtRates.map((row) => ({
    value: row.wht_name,
    label: formatWhtOptionLabel(row.wht_name, Number(row.wht_rate)),
    rate: Number(row.wht_rate),
  }));

  const legacy = (legacyType ?? "").trim();
  if (legacy && !options.some((opt) => opt.value === legacy)) {
    const rate = roundMoney(Number(legacyRate ?? 0));
    options.push({
      value: legacy,
      label: `${formatWhtOptionLabel(legacy, rate)} (ไม่ใช้งาน)`,
      rate,
    });
  }

  return [{ value: "", label: "None (0%)", rate: 0 }, ...options];
}

/** Resolve WHT preset from stored type/rate (edit mode). */
function resolveExpenseWht(
  whtType: string | null | undefined,
  whtRate: number | null | undefined,
  whtRates: MstWhtRate[],
): { type: string; rate: number } {
  const type = (whtType ?? "").trim();
  if (type) {
    const byType = whtRates.find((opt) => opt.wht_name === type);
    if (byType) {
      return { type: byType.wht_name, rate: Number(byType.wht_rate) };
    }
  }

  const rate = roundMoney(Number(whtRate ?? 0));
  if (rate > 0) {
    const byRate = whtRates.find(
      (opt) => Math.abs(Number(opt.wht_rate) - rate) < 0.001,
    );
    if (byRate) {
      return { type: byRate.wht_name, rate: Number(byRate.wht_rate) };
    }
  }

  if (type && rate > 0) {
    return { type, rate };
  }

  return { type: "", rate: 0 };
}

/** WHT on taxable base (Sub Total / net_amount) — Thai practice for OPEX. */
export function calculateExpenseWht(
  subTotal: number,
  whtRate: number,
  grandTotal: number,
): { whtAmount: number; netPayable: number } {
  const base = Number.isFinite(subTotal) && subTotal > 0 ? subTotal : 0;
  const rate = Number.isFinite(whtRate) && whtRate > 0 ? whtRate : 0;
  const whtAmount = roundMoney(base * (rate / 100));
  const grand = Number.isFinite(grandTotal) && grandTotal > 0 ? grandTotal : 0;
  const netPayable = roundMoney(Math.max(0, grand - whtAmount));
  return { whtAmount, netPayable };
}

/** Standard expense VAT math from a single base_amount input. */
export function calculateExpenseAmounts(
  baseAmount: number,
  vatType: ExpenseVatType,
): { net: number; vat: number; grand: number } {
  const base = roundMoney(Math.max(0, baseAmount));

  if (vatType === "NONE") {
    return { net: base, vat: 0, grand: base };
  }

  if (vatType === "EXCLUSIVE") {
    const vat = roundMoney(base * 0.07);
    return { net: base, vat, grand: roundMoney(base + vat) };
  }

  const vat = roundMoney((base * 7) / 107);
  const net = roundMoney(base - vat);
  return { net, vat, grand: base };
}

function tabHref(tab: ExpenseCreateTab): string {
  return `/expenses/create?tab=${tab}`;
}

function matchVendorId(
  vendorName: string | null | undefined,
  vendors: ExpenseVendorOption[],
): string {
  const needle = (vendorName ?? "").trim().toLowerCase();
  if (!needle) return "";

  const exact = vendors.find(
    (v) => v.company_name.trim().toLowerCase() === needle,
  );
  if (exact) return exact.id;

  const partial = vendors.find((v) => {
    const name = v.company_name.trim().toLowerCase();
    return name.includes(needle) || needle.includes(name);
  });
  return partial?.id ?? "";
}

function matchCategoryId(
  hint: string | null | undefined,
  categories: ExpenseCategory[],
): string {
  const key = (hint ?? "OTHER").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const names = CATEGORY_HINT_TO_NAMES[key] ?? CATEGORY_HINT_TO_NAMES.OTHER;

  for (const name of names) {
    const hit = categories.find(
      (c) => c.category_name.trim() === name && c.is_active,
    );
    if (hit) return hit.id;
  }

  return categories.find((c) => c.is_active)?.id ?? "";
}

function buildOcrRemark(
  extraction: ExpenseOcrScan,
  existingRemark: string,
): string {
  const parts: string[] = [];
  if (extraction.description) parts.push(extraction.description);
  if (extraction.invoice_no) parts.push(`เลขที่เอกสาร: ${extraction.invoice_no}`);
  if (extraction.reference_no) parts.push(`เลขอ้างอิง: ${extraction.reference_no}`);
  if (extraction.vendor_tax_id) parts.push(`Tax ID: ${extraction.vendor_tax_id}`);
  if (extraction.vehicle_plate) parts.push(`ทะเบียนรถ: ${extraction.vehicle_plate}`);
  if (extraction.vendor_address) parts.push(`ที่อยู่ผู้ขาย: ${extraction.vendor_address}`);

  const ocrBlock = parts.join("\n");
  const prev = existingRemark.trim();
  if (!ocrBlock) return prev;
  if (!prev) return ocrBlock;
  if (prev.includes(ocrBlock)) return prev;
  return `${prev}\n\n${ocrBlock}`;
}

function formatOcrTransportError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "เกิดข้อผิดพลาดขณะประมวลผล OCR — กรุณาลองใหม่อีกครั้ง";

  if (/unexpected response was received from the server/i.test(raw)) {
    return "ไม่สามารถส่งรูปไปประมวลผลได้ — ไฟล์อาจใหญ่เกินไป หรือ AI ใช้เวลานานเกินกำหนด กรุณาลองสแกนใหม่";
  }
  if (/\b413\b|payload too large|body exceeded/i.test(raw)) {
    return "ไฟล์รูปใหญ่เกินไป — ระบบบีบอัดอัตโนมัติแล้ว กรุณาลองใหม่หรือใช้รูปที่เล็กลง";
  }
  if (/\b504\b|timed out|timeout|deadline exceeded/i.test(raw)) {
    return "AI OCR ใช้เวลานานเกินกำหนด — กรุณาลองใหม่อีกครั้ง";
  }

  return raw;
}

export function ExpenseCreateWorkspace({
  categories: initialCategories,
  categoriesError,
  vendors,
  vendorsError,
  bankAccounts,
  bankAccountsError,
  defaultDate,
  defaultTab = "manual",
  defaultWhtRate,
  whtRates,
  whtRatesError,
  mode = "create",
  expenseId,
  documentNo,
  initialValues,
}: ExpenseCreateWorkspaceProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const cancelHref = isEdit && expenseId ? `/expenses/${expenseId}` : "/expenses";
  const resolvedDefaultWhtRate = useMemo(
    () => normalizeDefaultWhtRate(defaultWhtRate),
    [defaultWhtRate],
  );

  const inferredVatType = initialValues
    ? inferExpenseVatType(
        initialValues.net_amount,
        initialValues.vat_amount,
        initialValues.grand_total,
      )
    : ("NONE" as ExpenseVatType);
  const initialPayment = resolvePaymentMethod(initialValues?.payment_method);
  const initialWht = resolveExpenseWht(
    initialValues?.wht_type,
    initialValues?.wht_rate,
    whtRates,
  );
  const initialAmounts = initialValues
    ? {
        net: roundMoney(initialValues.net_amount),
        vat: roundMoney(initialValues.vat_amount),
        grand: roundMoney(initialValues.grand_total),
      }
    : { net: 0, vat: 0, grand: 0 };
  const initialWhtAmounts = calculateExpenseWht(
    initialAmounts.net,
    initialWht.rate,
    initialAmounts.grand,
  );

  const [tab, setTab] = useState<ExpenseCreateTab>("manual");
  const [billLines, setBillLines] = useState<
    Array<{
      description: string;
      quantity: number;
      unit_name: string | null;
      unit_price: number;
      line_total: number;
    }>
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrFileName, setOcrFileName] = useState<string | null>(null);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrPreviewKind, setOcrPreviewKind] = useState<"image" | "pdf" | "">("");
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] =
    useState<ExpenseCategory[]>(initialCategories);
  const [extraVendors, setExtraVendors] = useState<ExpenseVendorOption[]>([]);
  const [ocrQuota, setOcrQuota] = useState<OcrQuotaStatus | null>(null);
  const [preferredOcrModel, setPreferredOcrModel] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getOcrQuotaStatusAction().then((result) => {
      if (!cancelled) setOcrQuota(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Sync lock — blocks double-submit before React re-renders `isSubmitting`. */
  const submitLockRef = useRef(false);
  const ocrInputRef = useRef<HTMLInputElement>(null);
  const manualOcrInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  /**
   * RHF can drop File objects across handleSubmit / serialization.
   * Keep the authoritative File in a ref for FormData submit.
   */
  const attachmentFileRef = useRef<File | null>(null);
  const paymentSlipFileRef = useRef<File | null>(null);
  const paymentSlipInputRef = useRef<HTMLInputElement>(null);
  const [clearReceiptOnSave, setClearReceiptOnSave] = useState(false);
  const [clearPaymentSlipOnSave, setClearPaymentSlipOnSave] = useState(false);

  const form = useForm<ExpenseFormValues>({
    defaultValues: {
      expense_date: initialValues?.expense_date || defaultDate,
      vendor_id: initialValues?.vendor_id ?? "",
      vendor_name: "",
      vendor_tax_id: "",
      accounting_tax_tier: "CORP_VAT",
      reference_no: "",
      vehicle_plate: "",
      document_number: initialValues?.vendor_doc_no ?? "",
      document_date: initialValues?.expense_date || defaultDate,
      category_id:
        initialValues?.category_id || initialCategories[0]?.id || "",
      vat_type: inferredVatType,
      sub_total: initialAmounts.net,
      vat_amount: initialAmounts.vat,
      grand_total: initialAmounts.grand,
      wht_type: initialWht.type,
      wht_rate: initialWht.rate,
      wht_amount: initialWhtAmounts.whtAmount,
      net_payable: initialWhtAmounts.netPayable,
      base_amount: initialValues
        ? resolveBaseAmountInput(initialValues, inferredVatType)
        : "",
      payment_method: initialPayment,
      bank_account_id: initialValues?.bank_account_id ?? "",
      remark: initialValues?.remark ?? "",
      items: [],
      attachment_file: null,
      receipt_url: initialValues?.receipt_url ?? "",
      payment_slip_file: null,
      payment_slip_url: initialValues?.payment_slip_url ?? "",
      is_installment: Boolean(initialValues?.is_installment),
      installments:
        initialValues?.installments && initialValues.installments.length > 0
          ? initialValues.installments
          : [],
    },
    mode: "onChange",
  });

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = form;

  const { fields, replace } = useFieldArray({
    control,
    name: "items",
  });

  const {
    fields: installmentFields,
    append: appendInstallment,
    remove: removeInstallment,
    replace: replaceInstallments,
  } = useFieldArray({
    control,
    name: "installments",
  });

  const watchedExpenseDate = useWatch({ control, name: "expense_date" });
  const watchedBaseAmount = useWatch({ control, name: "base_amount" });
  const watchedVatType = useWatch({ control, name: "vat_type" });
  const watchedPaymentMethod = useWatch({ control, name: "payment_method" });
  const watchedVendorId = useWatch({ control, name: "vendor_id" });
  const watchedVendorName = useWatch({ control, name: "vendor_name" });
  const watchedCategoryId = useWatch({ control, name: "category_id" });
  const watchedBankAccountId = useWatch({ control, name: "bank_account_id" });
  const watchedSubTotal = useWatch({ control, name: "sub_total" });
  const watchedVatAmount = useWatch({ control, name: "vat_amount" });
  const watchedGrandTotal = useWatch({ control, name: "grand_total" });
  const watchedWhtType = useWatch({ control, name: "wht_type" });
  const watchedWhtRate = useWatch({ control, name: "wht_rate" });
  const watchedWhtAmount = useWatch({ control, name: "wht_amount" });
  const watchedNetPayable = useWatch({ control, name: "net_payable" });
  const watchedAttachmentFile = useWatch({
    control,
    name: "attachment_file",
  });
  const watchedReceiptUrl = useWatch({ control, name: "receipt_url" });
  const watchedPaymentSlipFile = useWatch({
    control,
    name: "payment_slip_file",
  });
  const watchedPaymentSlipUrl = useWatch({
    control,
    name: "payment_slip_url",
  });
  const watchedIsInstallment = useWatch({
    control,
    name: "is_installment",
  });
  const watchedInstallments = useWatch({
    control,
    name: "installments",
  });

  // Client-side WHT math — Sub Total × rate; Net Payable = Grand Total − WHT
  useEffect(() => {
    const effectiveRate = resolveEffectiveWhtRate(
      watchedWhtType,
      watchedWhtRate,
      resolvedDefaultWhtRate,
    );
    const { whtAmount, netPayable } = calculateExpenseWht(
      Number(watchedSubTotal ?? 0),
      effectiveRate,
      Number(watchedGrandTotal ?? 0),
    );
    setValue("wht_amount", whtAmount, { shouldValidate: true });
    setValue("net_payable", netPayable, { shouldValidate: true });
  }, [
    watchedSubTotal,
    watchedWhtType,
    watchedWhtRate,
    watchedGrandTotal,
    resolvedDefaultWhtRate,
    setValue,
  ]);

  /**
   * Auto-split principal จาก Net Payable ÷ จำนวนงวด
   * (หักดอกเบี้ยรวมก่อน เพื่อให้เงินต้น+ดอกเบี้ย = Net Payable เสมอ)
   * เศษสตางค์ปัดไปงวดสุดท้าย
   */
  useEffect(() => {
    if (!watchedIsInstallment) return;
    const count = installmentFields.length;
    if (count <= 0) return;

    const netPayable = roundMoney(Number(watchedNetPayable ?? 0));
    const current = getValues("installments") ?? [];
    const interestSum = roundMoney(
      current.reduce((sum, row) => sum + Number(row.interest_amount ?? 0), 0),
    );
    // เมื่อดอกเบี้ย = 0 → เท่ากับ Net Payable / n ตามสเปก
    const principalPool = roundMoney(Math.max(0, netPayable - interestSum));
    const principals = splitPrincipalAcrossInstallments(principalPool, count);

    let needsUpdate = false;
    for (let i = 0; i < count; i += 1) {
      const existing = roundMoney(Number(current[i]?.principal_amount ?? 0));
      if (!moneyEquals(existing, principals[i] ?? 0)) {
        needsUpdate = true;
        break;
      }
    }
    if (!needsUpdate) return;

    for (let i = 0; i < count; i += 1) {
      setValue(`installments.${i}.principal_amount`, principals[i] ?? 0, {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  }, [
    watchedIsInstallment,
    watchedNetPayable,
    installmentFields.length,
    watchedInstallments,
    getValues,
    setValue,
  ]);

  const installmentPrincipalTotal = roundMoney(
    (watchedInstallments ?? []).reduce(
      (sum, row) => sum + Number(row.principal_amount ?? 0),
      0,
    ),
  );
  const installmentInterestTotal = roundMoney(
    (watchedInstallments ?? []).reduce(
      (sum, row) => sum + Number(row.interest_amount ?? 0),
      0,
    ),
  );
  const installmentCombinedTotal = roundMoney(
    installmentPrincipalTotal + installmentInterestTotal,
  );
  const netPayableAmount = roundMoney(Number(watchedNetPayable ?? 0));
  const principalMatchesNetPayable = moneyEquals(
    installmentPrincipalTotal,
    netPayableAmount,
  );
  /**
   * Submit guard (ERP): ผลรวมเงินต้น + ดอกเบี้ย ต้องเท่ากับ Net Payable.
   * เมื่อระบบแยกเงินต้นจาก Net Payable อัตโนมัติ ดอกเบี้ยรวมต้องเป็น 0
   * หรือผู้ใช้ต้องปรับยอดให้สมดุลก่อนบันทึก.
   */
  const installmentTotalsMatchNetPayable = moneyEquals(
    installmentCombinedTotal,
    netPayableAmount,
  );
  const installmentSubmitBlocked =
    Boolean(watchedIsInstallment) &&
    (installmentFields.length === 0 || !installmentTotalsMatchNetPayable);

  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<
    string | null
  >(initialValues?.receipt_url ?? null);
  const [paymentSlipPreviewUrl, setPaymentSlipPreviewUrl] = useState<
    string | null
  >(initialValues?.payment_slip_url ?? null);

  useEffect(() => {
    if (
      watchedAttachmentFile instanceof File &&
      watchedAttachmentFile.type.startsWith("image/")
    ) {
      const objectUrl = URL.createObjectURL(watchedAttachmentFile);
      setAttachmentPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (
      watchedAttachmentFile instanceof File &&
      watchedAttachmentFile.type === "application/pdf"
    ) {
      setAttachmentPreviewUrl(null);
      return;
    }
    setAttachmentPreviewUrl(watchedReceiptUrl?.trim() || null);
  }, [watchedAttachmentFile, watchedReceiptUrl]);

  useEffect(() => {
    if (
      watchedPaymentSlipFile instanceof File &&
      watchedPaymentSlipFile.type.startsWith("image/")
    ) {
      const objectUrl = URL.createObjectURL(watchedPaymentSlipFile);
      setPaymentSlipPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (
      watchedPaymentSlipFile instanceof File &&
      watchedPaymentSlipFile.type === "application/pdf"
    ) {
      setPaymentSlipPreviewUrl(null);
      return;
    }
    setPaymentSlipPreviewUrl(watchedPaymentSlipUrl?.trim() || null);
  }, [watchedPaymentSlipFile, watchedPaymentSlipUrl]);

  function isAllowedExpenseAttachment(file: File): boolean {
    const mime = (file.type || "").toLowerCase();
    if (!mime) return true;
    return mime.startsWith("image/") || mime === "application/pdf";
  }

  async function setAttachmentFile(file: File | null) {
    if (!file) {
      attachmentFileRef.current = null;
      setValue("attachment_file", null, { shouldValidate: true });
      return;
    }
    if (!isAllowedExpenseAttachment(file)) {
      toast.error("รองรับเฉพาะไฟล์รูปภาพ (.jpg, .png, .webp) หรือ PDF");
      attachmentFileRef.current = null;
      setValue("attachment_file", null, { shouldValidate: true });
      return;
    }

    const mime = (file.type || "").toLowerCase();
    let nextFile = file;
    if (mime.startsWith("image/")) {
      try {
        nextFile = await compressImage(file);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `บีบอัดใบเสร็จไม่สำเร็จ: ${err.message}`
            : "บีบอัดใบเสร็จไม่สำเร็จ",
        );
        attachmentFileRef.current = null;
        setValue("attachment_file", null, { shouldValidate: true });
        return;
      }
    }

    attachmentFileRef.current = nextFile;
    setClearReceiptOnSave(false);
    setValue("attachment_file", nextFile, { shouldValidate: true });
  }

  function clearAttachment() {
    attachmentFileRef.current = null;
    setClearReceiptOnSave(true);
    setValue("attachment_file", null, { shouldValidate: true });
    setValue("receipt_url", "", { shouldValidate: true });
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  async function setPaymentSlipFile(file: File | null) {
    if (!file) {
      paymentSlipFileRef.current = null;
      setValue("payment_slip_file", null, { shouldValidate: true });
      return;
    }
    if (!isAllowedExpenseAttachment(file)) {
      toast.error("รองรับเฉพาะไฟล์รูปภาพ (.jpg, .png, .webp) หรือ PDF");
      paymentSlipFileRef.current = null;
      setValue("payment_slip_file", null, { shouldValidate: true });
      return;
    }

    const mime = (file.type || "").toLowerCase();
    let nextFile = file;
    if (mime.startsWith("image/")) {
      try {
        nextFile = await compressImage(file);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `บีบอัดสลิปไม่สำเร็จ: ${err.message}`
            : "บีบอัดสลิปไม่สำเร็จ",
        );
        paymentSlipFileRef.current = null;
        setValue("payment_slip_file", null, { shouldValidate: true });
        return;
      }
    }

    paymentSlipFileRef.current = nextFile;
    setClearPaymentSlipOnSave(false);
    setValue("payment_slip_file", nextFile, { shouldValidate: true });
  }

  function clearPaymentSlip() {
    paymentSlipFileRef.current = null;
    setClearPaymentSlipOnSave(true);
    setValue("payment_slip_file", null, { shouldValidate: true });
    setValue("payment_slip_url", "", { shouldValidate: true });
    if (paymentSlipInputRef.current) paymentSlipInputRef.current.value = "";
  }

  function syncAmountsFromBase(
    baseAmountRaw: string,
    vatType: ExpenseVatType,
  ) {
    const amounts = calculateExpenseAmounts(
      parseAmount(baseAmountRaw),
      vatType,
    );
    setValue("sub_total", amounts.net, { shouldValidate: true });
    setValue("vat_amount", amounts.vat, { shouldValidate: true });
    setValue("grand_total", amounts.grand, { shouldValidate: true });
  }

  const whtOptions = useMemo(
    () =>
      buildWhtDropdownOptions(
        whtRates,
        initialValues?.wht_type,
        initialValues?.wht_rate,
      ),
    [whtRates, initialValues?.wht_type, initialValues?.wht_rate],
  );

  const vendorChoices = useMemo(() => {
    const known = new Set(vendors.map((vendor) => vendor.id));
    return [
      ...vendors,
      ...extraVendors.filter((vendor) => !known.has(vendor.id)),
    ];
  }, [vendors, extraVendors]);

  const vendorOptions = useMemo(
    () =>
      vendorChoices.map((vendor) => ({
        id: vendor.id,
        company_name: vendor.company_name,
      })),
    [vendorChoices],
  );

  const baseAmountLabel =
    watchedVatType === "INCLUSIVE"
      ? "จำนวนเงินรวมภาษี (Grand Total)"
      : watchedVatType === "EXCLUSIVE"
        ? "ยอดก่อนภาษี (Net Amount)"
        : "จำนวนเงิน (Base Amount)";

  const baseAmountHint =
    watchedVatType === "INCLUSIVE"
      ? "กรอกยอดรวม VAT แล้ว — ระบบจะถอด Net / VAT ให้"
      : watchedVatType === "EXCLUSIVE"
        ? "กรอกยอดก่อน VAT — ระบบจะบวก VAT 7% ให้"
        : "ไม่มี VAT — Net = Grand = จำนวนที่กรอก";

  function handleTabChange(next: string) {
    if (isEdit) return;
    const value: ExpenseCreateTab = next === "manual" ? "manual" : "ocr";
    setTab(value);
    router.replace(tabHref(value), { scroll: false });
  }

  function handleCategoryCreated(category: ExpenseCategory) {
    setCategories((prev) => {
      if (prev.some((row) => row.id === category.id)) return prev;
      return [...prev, category].sort((a, b) =>
        a.category_name.localeCompare(b.category_name, "th"),
      );
    });
  }

  function applyOcrResult(extraction: ExpenseOcrScan) {
    const vatType: ExpenseVatType =
      extraction.vat_mode === "EXCLUSIVE"
        ? "EXCLUSIVE"
        : extraction.vat_mode === "NO_VAT" || !extraction.has_vat
          ? "NONE"
          : "INCLUSIVE";
    let nextCategories = categories;
    if (
      extraction.category_id &&
      !categories.some((category) => category.id === extraction.category_id)
    ) {
      nextCategories = [
        ...categories,
        {
          id: extraction.category_id,
          category_name: extraction.category_name || "ค่าน้ำมันเชื้อเพลิงและยานพาหนะ",
          description: null,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      ];
      setCategories(nextCategories);
    }
    const knownVendor =
      (extraction.contact_id
        ? vendorChoices.find((vendor) => vendor.id === extraction.contact_id)
        : null) ?? null;
    const matchedContactId = extraction.contact_id;
    const matchedVendorName = extraction.vendor_name;
    if (matchedContactId && matchedVendorName && !knownVendor) {
      setExtraVendors((current) =>
        current.some((vendor) => vendor.id === matchedContactId)
          ? current
          : [
              ...current,
              {
                id: matchedContactId,
                company_name: matchedVendorName,
              },
            ],
      );
    }
    const matchedVendorId =
      extraction.contact_id ||
      matchVendorId(extraction.vendor_name, vendorChoices);
    const matchedCategoryId =
      extraction.category_id || matchCategoryId(extraction.category, nextCategories);
    const docDate = extraction.expense_date || getValues("expense_date");
    const current = getValues();
    const description = extraction.description?.trim() || extraction.vendor_name || "ค่าใช้จ่าย";
    const baseAmount =
      vatType === "EXCLUSIVE" ? extraction.sub_total : extraction.total_amount;
    setBillLines(extraction.line_items ?? []);

    reset(
      {
        ...current,
        vendor_name: extraction.vendor_name ?? "",
        vendor_tax_id: extraction.vendor_tax_id ?? "",
        accounting_tax_tier: extraction.accounting_tax_tier,
        reference_no: extraction.reference_no ?? "",
        vehicle_plate: extraction.vehicle_plate ?? "",
        vendor_id: matchedVendorId || current.vendor_id,
        document_number: extraction.invoice_no ?? "",
        document_date: docDate,
        expense_date: docDate,
        category_id: matchedCategoryId || current.category_id,
        vat_type: vatType,
        sub_total: extraction.sub_total,
        vat_amount: extraction.vat_amount,
        grand_total: extraction.total_amount,
        base_amount: String(baseAmount),
        items: [
          {
            description,
            amount: extraction.total_amount || extraction.sub_total,
            category_hint: extraction.category || "OTHER",
          },
        ],
        remark: buildOcrRemark(extraction, current.remark),
        receipt_url: extraction.attachment_url || current.receipt_url,
      },
      { keepDefaultValues: false },
    );
  }

  async function receiptToJpeg(file: File) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("บีบอัดรูปไม่สำเร็จ");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return {
      dataUrl,
      file: new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" }),
    };
  }

  async function runExpenseOcr(file: File | null | undefined) {
    if (!file || file.size === 0) {
      toast.error("กรุณาเลือกไฟล์รูปบิลก่อน");
      return;
    }

    const mime = (file.type || "").toLowerCase();
    const isPdf = mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = mime.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!isPdf && !isImage) {
      toast.error("รองรับไฟล์รูปภาพ (.jpg, .png, .webp) และ PDF");
      return;
    }

    setIsOcrProcessing(true);
    setError(null);
    setOcrFileName(file.name);
    if (ocrPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(ocrPreviewUrl);

    try {
      let fileBase64 = "";
      let mimeType = isPdf ? "application/pdf" : "image/jpeg";
      if (isPdf) {
        fileBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("อ่านไฟล์ PDF ไม่สำเร็จ"));
          reader.readAsDataURL(file);
        });
        const preview = URL.createObjectURL(file);
        setOcrPreviewUrl(preview);
        setOcrPreviewKind("pdf");
        const safePdf = new File([file], `receipt-${Date.now()}.pdf`, { type: "application/pdf" });
        void setAttachmentFile(safePdf);
      } else {
        const jpeg = await receiptToJpeg(file);
        fileBase64 = jpeg.dataUrl;
        setOcrPreviewUrl(jpeg.dataUrl);
        setOcrPreviewKind("image");
        void setAttachmentFile(jpeg.file);
      }

      const response = await fetch("/api/expenses/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64,
          mimeType,
          fileName: `exp-${Date.now()}.${isPdf ? "pdf" : "jpg"}`,
          preferredModel: preferredOcrModel,
        }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: ExpenseOcrScan;
        modelNotice?: string | null;
      };

      if (!response.ok || !result.success || !result.data) {
        const message = result.error || "สแกนบิลไม่สำเร็จ";
        console.error("[Expense OCR] /api/expenses/ocr failed:", message);
        setError(message);
        toast.error(message);
        return;
      }

      if (!isEdit) {
        setTab("manual");
        // Sync URL without Next.js navigation — router.replace remounts the
        // workspace and wipes RHF state set by applyOcrResult.
        window.history.replaceState(null, "", tabHref("manual"));
      }

      applyOcrResult(result.data);
      toast.success(
        result.modelNotice || "อ่านบิลสำเร็จ — ตรวจสอบข้อมูลก่อนบันทึก Draft",
      );
      const quota = await getOcrQuotaStatusAction();
      setOcrQuota(quota);
    } catch (err) {
      console.error("[Expense OCR] processExpenseOCR threw:", err);
      const msg = formatOcrTransportError(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setIsOcrProcessing(false);
      if (ocrInputRef.current) ocrInputRef.current.value = "";
      if (manualOcrInputRef.current) manualOcrInputRef.current.value = "";
    }
  }

  async function onSaveDraft(values: ExpenseFormValues) {
    if (submitLockRef.current || isSubmitting || isOcrProcessing) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(null);

    const unlock = () => {
      submitLockRef.current = false;
      setIsSubmitting(false);
    };

    if (!values.vendor_id) {
      const msg = "กรุณาเลือกผู้ให้บริการ (Vendor)";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (!values.category_id) {
      const msg = "กรุณาเลือกหมวดหมู่ค่าใช้จ่าย";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (!values.expense_date) {
      const msg = "กรุณาระบุวันที่เกิดค่าใช้จ่าย";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (!values.base_amount || parseAmount(values.base_amount) < 0) {
      const msg = "กรุณาระบุจำนวนเงินให้ถูกต้อง";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (values.payment_method === "TRANSFER" && !values.bank_account_id) {
      const msg = "กรุณาเลือกบัญชีธนาคารเมื่อชำระแบบโอนเงิน";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (values.is_installment) {
      if (!values.installments || values.installments.length === 0) {
        const msg = "กรุณาเพิ่มงวดผ่อนชำระอย่างน้อย 1 งวด";
        setError(msg);
        toast.error(msg);
        unlock();
        return;
      }
      const principalSum = roundMoney(
        values.installments.reduce(
          (sum, row) => sum + Number(row.principal_amount ?? 0),
          0,
        ),
      );
      const interestSum = roundMoney(
        values.installments.reduce(
          (sum, row) => sum + Number(row.interest_amount ?? 0),
          0,
        ),
      );
      const combined = roundMoney(principalSum + interestSum);
      const netPayable = roundMoney(Number(values.net_payable ?? 0));
      if (!moneyEquals(combined, netPayable)) {
        const msg =
          "ผลรวมเงินต้น + ดอกเบี้ย ต้องเท่ากับยอด Net Payable ก่อนบันทึก";
        setError(msg);
        toast.error(msg);
        unlock();
        return;
      }
      for (const row of values.installments) {
        if (!row.due_date) {
          const msg = `งวดที่ ${row.installment_period}: กรุณาระบุวันครบกำหนด`;
          setError(msg);
          toast.error(msg);
          unlock();
          return;
        }
        if (
          !Number.isFinite(Number(row.principal_amount)) ||
          Number(row.principal_amount) < 0
        ) {
          const msg = `งวดที่ ${row.installment_period}: เงินต้นไม่ถูกต้อง`;
          setError(msg);
          toast.error(msg);
          unlock();
          return;
        }
      }
    }

    try {
      // Prefer ref (authoritative) — RHF File fields are unreliable on submit.
      const receiptFile =
        attachmentFileRef.current instanceof File
          ? attachmentFileRef.current
          : values.attachment_file instanceof File
            ? values.attachment_file
            : null;

      const effectiveWhtRate = resolveEffectiveWhtRate(
        values.wht_type,
        values.wht_rate,
        resolvedDefaultWhtRate,
      );
      const whtTotals = calculateExpenseWht(
        values.sub_total,
        effectiveWhtRate,
        values.grand_total,
      );

      const formData = new FormData();
      formData.append("category_id", values.category_id);
      formData.append("vendor_id", values.vendor_id);
      formData.append("expense_date", values.expense_date);
      formData.append("net_amount", String(values.sub_total));
      formData.append("vat_amount", String(values.vat_amount));
      formData.append("wht_type", values.wht_type.trim());
      formData.append("wht_rate", String(effectiveWhtRate));
      formData.append("wht_amount", String(whtTotals.whtAmount));
      formData.append("net_payable", String(whtTotals.netPayable));
      formData.append("payment_method", values.payment_method);
      formData.append(
        "bank_account_id",
        values.payment_method === "TRANSFER" ? values.bank_account_id : "",
      );
      formData.append("remark", values.remark.trim());
      formData.append("accounting_tax_tier", values.accounting_tax_tier);
      formData.append("tax_invoice_no", values.document_number.trim());
      formData.append("reference_no", values.reference_no.trim());
      formData.append("vehicle_plate", values.vehicle_plate.trim());
      formData.append("vendor_tax_id", values.vendor_tax_id.trim());
      formData.append(
        "tax_type",
        values.vat_type === "NONE" ? "NO_VAT" : values.vat_type,
      );
      if (!isEdit || billLines.length > 0) {
        formData.append("sync_line_items", "1");
        formData.append("line_items", JSON.stringify(billLines));
      }
      // Map UI/OCR "document_number" → DB column expenses.vendor_doc_no
      const vendorDocNo = (
        values.document_number ||
        getValues("document_number") ||
        ""
      ).trim();
      formData.append("vendor_doc_no", vendorDocNo);
      formData.append("receipt_url", values.receipt_url.trim());
      if (clearReceiptOnSave) {
        formData.append("clear_receipt", "1");
      }
      if (receiptFile) {
        formData.append("receipt_file", receiptFile, receiptFile.name);
      }

      const paymentSlipFile =
        paymentSlipFileRef.current instanceof File
          ? paymentSlipFileRef.current
          : values.payment_slip_file instanceof File
            ? values.payment_slip_file
            : null;
      formData.append("payment_slip_url", values.payment_slip_url.trim());
      if (clearPaymentSlipOnSave) {
        formData.append("clear_payment_slip", "1");
      }
      if (paymentSlipFile) {
        formData.append(
          "payment_slip_file",
          paymentSlipFile,
          paymentSlipFile.name,
        );
      }

      formData.append("is_installment", values.is_installment ? "1" : "0");
      if (values.is_installment) {
        formData.append(
          "installments_json",
          JSON.stringify(
            values.installments.map((row, index) => ({
              installment_period: Number(row.installment_period) || index + 1,
              due_date: row.due_date,
              principal_amount: Number(row.principal_amount) || 0,
              interest_amount: Number(row.interest_amount) || 0,
            })),
          ),
        );
      }

      const result =
        isEdit && expenseId
          ? await updateDraftExpense(expenseId, formData)
          : await createDraftExpense(formData);

      // Duplicate Invoice Early Warning — keep form data intact for review
      if (result.error === DUPLICATE_INVOICE_ERROR) {
        const msg = result.message?.trim() || DUPLICATE_INVOICE_MESSAGE;
        setError(msg);
        toast.error(msg, {
          duration: 8000,
          description:
            "กรุณาตรวจ Vendor / วันที่บิล / เลขที่บิลผู้จำหน่าย ก่อนบันทึกอีกครั้ง",
        });
        unlock();
        return;
      }

      if (result.error || !result.data?.id) {
        const msg =
          result.error ??
          (isEdit ? "อัปเดต Draft ไม่สำเร็จ" : "บันทึก Draft ไม่สำเร็จ");
        setError(msg);
        toast.error(msg);
        unlock();
        return;
      }

      toast.success(
        isEdit
          ? `อัปเดต Draft ${result.data.document_no} สำเร็จ`
          : `บันทึก Draft ${result.data.document_no} สำเร็จ`,
      );

      // Flush client Router Cache so /expenses list shows the new DRAFT
      // after Soft Navigation (revalidatePath alone is not always enough).
      router.refresh();
      router.push("/expenses/" + result.data.id);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : isEdit
            ? "เกิดข้อผิดพลาดขณะอัปเดต Draft"
            : "เกิดข้อผิดพลาดขณะบันทึก Draft";
      setError(msg);
      toast.error(msg);
      unlock();
    }
  }

  const formBusy = isSubmitting || isOcrProcessing;

  return (
    <div className="space-y-5">
      {ocrQuota ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold leading-relaxed text-slate-700">
            {ocrQuota.models.length > 0
              ? ocrQuota.models.map((model, index) => (
                  <span key={model.model}>
                    {index > 0 ? " | " : null}
                    <button
                      type="button"
                      className={
                        preferredOcrModel === model.model
                          ? "rounded bg-blue-100 px-1 text-blue-800"
                          : model.exhausted
                            ? "rounded px-1 text-amber-700"
                            : "rounded px-1 hover:bg-white"
                      }
                      onClick={() =>
                        setPreferredOcrModel((current) =>
                          current === model.model ? "" : model.model,
                        )
                      }
                    >
                      {formatOcrQuotaChip(model)}
                    </button>
                  </span>
                ))
              : "ยังไม่มีข้อมูลโควตา OCR"}
          </p>
          <a
            href="https://ai.dev/rate-limit"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-700"
          >
            {ocrQuota.resetNote}
            {preferredOcrModel
              ? " · คลิกโมเดลที่เลือกอีกครั้งเพื่อกลับไปใช้ค่าจาก System Parameters"
              : " · คลิกชื่อโมเดลเพื่อเลือกใช้ก่อน ถ้าโควตาเต็มระบบจะสลับต่ออัตโนมัติ"}
            <ExternalLink className="size-3" aria-hidden />
          </a>
          {ocrQuota.error ? (
            <p className="mt-1 text-[10px] text-red-600">{ocrQuota.error}</p>
          ) : null}
        </div>
      ) : null}
      {categoriesError || vendorsError || bankAccountsError || whtRatesError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {[
            categoriesError
              ? `โหลดหมวดหมู่ไม่สำเร็จ: ${categoriesError}`
              : null,
            vendorsError
              ? `โหลดผู้ให้บริการไม่สำเร็จ: ${vendorsError}`
              : null,
            bankAccountsError
              ? `โหลดบัญชีธนาคารไม่สำเร็จ: ${bankAccountsError}`
              : null,
            whtRatesError
              ? `โหลดอัตราหัก ณ ที่จ่ายไม่สำเร็จ: ${whtRatesError}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={handleTabChange} className="space-y-5">
        {false ? (
          <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
            <TabsTrigger value="ocr" className="gap-1.5" disabled={formBusy}>
              <Sparkles className="h-3.5 w-3.5" />
              สแกนบิลด้วย AI (Smart OCR)
            </TabsTrigger>
            <TabsTrigger
              value="manual"
              className="gap-1.5"
              disabled={formBusy}
            >
              <PenLine className="h-3.5 w-3.5" />
              กรอกข้อมูลเอง (Manual)
            </TabsTrigger>
          </TabsList>
        ) : null}

        {isEdit ? null : (
          <TabsContent value="ocr">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  Smart OCR
                </CardTitle>
                <CardDescription>
                  อัปโหลดรูปหรือ PDF ใบเสร็จ — ระบบส่งให้ Gemini อ่านบิลแล้วเติมฟอร์ม Manual ให้ตรวจทาน
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label
                  htmlFor="expense-ocr-upload"
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/80 px-6 py-14 text-center transition",
                    "hover:border-blue-400 hover:bg-blue-50/40",
                    isOcrProcessing && "pointer-events-none opacity-70",
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void runExpenseOcr(e.dataTransfer.files?.[0]);
                  }}
                >
                  <div className="grid size-14 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm">
                    {isOcrProcessing ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <ImagePlus className="h-6 w-6" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {isOcrProcessing
                        ? "กำลังอ่านบิลด้วย AI..."
                        : "ลากวางใบเสร็จที่นี่ หรือคลิกเพื่อเลือกไฟล์"}
                    </p>
                    <p className="text-xs text-slate-500">
                      รองรับ JPG / PNG / WEBP / PDF
                    </p>
                  </div>
                  {ocrFileName ? (
                    <Badge variant="blue">{ocrFileName}</Badge>
                  ) : (
                    <Badge variant="slate">ยังไม่ได้เลือกไฟล์</Badge>
                  )}
                  <input
                    ref={ocrInputRef}
                    id="expense-ocr-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                    className="sr-only"
                    disabled={isOcrProcessing}
                    onChange={(e) => {
                      void runExpenseOcr(e.target.files?.[0]);
                    }}
                  />
                </label>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="manual">
          <form
            onSubmit={handleSubmit(onSaveDraft)}
            className={
              isEdit
                ? "space-y-5"
                : "grid items-start gap-5 xl:grid-cols-[minmax(280px,440px)_minmax(0,1fr)]"
            }
          >
            {isEdit ? null : (
              <aside className="xl:sticky xl:top-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">ตัวอย่างบิล / PDF</CardTitle>
                    <CardDescription>
                      วางรูปหรือ PDF แล้วระบบจะสแกนด้วยเครื่อง OCR เดียวกับรับสินค้า
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                        className="sr-only"
                        disabled={formBusy}
                        onChange={(e) => {
                          void runExpenseOcr(e.target.files?.[0]);
                        }}
                      />
                      {isOcrProcessing ? "กำลังอ่านบิล..." : "คลิกหรือวางไฟล์ .jpg .png .webp .pdf"}
                    </label>
                    {ocrPreviewUrl && ocrPreviewKind === "pdf" ? (
                      <iframe
                        title="ตัวอย่างใบเสร็จ PDF"
                        src={ocrPreviewUrl}
                        className="h-[480px] w-full rounded-lg border"
                      />
                    ) : null}
                    {ocrPreviewUrl && ocrPreviewKind !== "pdf" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ocrPreviewUrl}
                        alt="ตัวอย่างใบเสร็จ"
                        className="max-h-[480px] w-full rounded-lg border object-contain"
                      />
                    ) : null}
                  </CardContent>
                </Card>
              </aside>
            )}
            <div className="space-y-5">
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Paperclip className="h-4 w-4 text-blue-600" />
                    แนบใบเสร็จ (Attachment)
                  </CardTitle>
                  <CardDescription>
                    ลากวางหรือเลือกไฟล์รูปใบเสร็จ — บันทึก Draft จะอัปโหลดไป
                    Storage bucket{" "}
                    <code className="text-xs">expense_documents</code>
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={manualOcrInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                    className="sr-only"
                    disabled={formBusy}
                    onChange={(e) => {
                      void runExpenseOcr(e.target.files?.[0]);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={formBusy}
                    aria-busy={isOcrProcessing}
                    onClick={() => manualOcrInputRef.current?.click()}
                  >
                    {isOcrProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ScanLine className="h-4 w-4" />
                    )}
                    Upload Bill OCR
                  </Button>
                  {(watchedAttachmentFile || watchedReceiptUrl) && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={formBusy}
                      onClick={clearAttachment}
                    >
                      <X className="h-4 w-4" />
                      ลบไฟล์
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.pdf"
                  className="sr-only"
                  disabled={formBusy}
                  onChange={(e) => {
                    void setAttachmentFile(e.target.files?.[0] ?? null);
                  }}
                />
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center transition",
                    "hover:border-blue-400 hover:bg-blue-50/40",
                    formBusy && "pointer-events-none opacity-70",
                  )}
                  onClick={() => attachmentInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      attachmentInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void setAttachmentFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                >
                  {attachmentPreviewUrl ? (
                    <div className="w-full max-w-md space-y-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachmentPreviewUrl}
                        alt="ตัวอย่างใบเสร็จ"
                        className="mx-auto max-h-56 rounded-xl border border-slate-200 object-contain shadow-sm"
                      />
                      <Badge variant="blue">
                        {watchedAttachmentFile instanceof File
                          ? watchedAttachmentFile.name
                          : "ใบเสร็จที่แนบไว้"}
                      </Badge>
                    </div>
                  ) : watchedAttachmentFile instanceof File ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="grid size-14 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm">
                        <FileText className="h-6 w-6" />
                      </div>
                      <Badge variant="blue">{watchedAttachmentFile.name}</Badge>
                      <p className="text-xs text-slate-500">
                        ไฟล์ PDF — จะอัปโหลดเมื่อบันทึก Draft
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid size-14 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm">
                        <ImagePlus className="h-6 w-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-800">
                          ลากวางรูปใบเสร็จที่นี่ หรือคลิกเพื่อเลือกไฟล์
                        </p>
                        <p className="text-xs text-slate-500">
                          รองรับ JPG / PNG / WEBP / PDF (สูงสุด 10MB)
                        </p>
                      </div>
                      <Badge variant="slate">ยังไม่ได้แนบไฟล์</Badge>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PenLine className="h-4 w-4 text-blue-600" />
                  {isEdit
                    ? `แก้ไข Draft${documentNo ? ` · ${documentNo}` : ""}`
                    : "ตรวจสอบข้อมูลบิลก่อนบันทึก"}
                </CardTitle>
                <CardDescription>
                  {isEdit
                    ? "อัปเดตได้เฉพาะสถานะ DRAFT · VAT คำนวณอัตโนมัติ · บันทึกแล้วกลับหน้ารายละเอียด"
                    : "Combobox ค้นหาได้ · VAT คำนวณอัตโนมัติ · Late Numbering DRAFT · รองรับ AI OCR"}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="expense_date">วันที่เกิดค่าใช้จ่าย</Label>
                  <Input
                    id="expense_date"
                    type="date"
                    disabled={formBusy}
                    value={watchedExpenseDate}
                    onChange={(e) => {
                      setValue("expense_date", e.target.value, {
                        shouldValidate: true,
                      });
                      setValue("document_date", e.target.value, {
                        shouldValidate: true,
                      });
                    }}
                  />
                </div>

                <div>
                  <Label htmlFor="document_number">
                    เลขที่เอกสาร / ใบกำกับภาษี
                  </Label>
                  <Input
                    id="document_number"
                    type="text"
                    placeholder="เลขที่ใบเสร็จ / ใบกำกับจากบิล"
                    disabled={formBusy}
                    {...register("document_number")}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    ใช้กันบิลซ้ำ: Vendor + วันที่บิล + เลขที่บิล
                  </p>
                </div>

                <div>
                  <Label>ผู้ให้บริการ (Vendor)</Label>
                  <VendorCombobox
                    options={vendorOptions}
                    value={watchedVendorId}
                    onChange={(id) => {
                      setValue("vendor_id", id, { shouldValidate: true });
                      const name =
                        vendorChoices.find((v) => v.id === id)?.company_name ?? "";
                      setValue("vendor_name", name, { shouldValidate: true });
                    }}
                    disabled={formBusy || vendorChoices.length === 0}
                    placeholder="ค้นหาและเลือกผู้ให้บริการ..."
                    emptyMessage="ไม่พบผู้ให้บริการ"
                  />
                  {watchedVendorName && !watchedVendorId ? (
                    <p className="mt-1 text-[11px] text-amber-600">
                      OCR อ่านชื่อ: {watchedVendorName} — ยังไม่พบในระบบ
                      กรุณาเลือก Vendor ด้วยตนเอง
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label htmlFor="vendor_name">ชื่อผู้ขาย (OCR)</Label>
                  <Input
                    id="vendor_name"
                    type="text"
                    disabled={formBusy}
                    {...register("vendor_name")}
                  />
                </div>

                <div>
                  <Label htmlFor="accounting_tax_tier">ประเภททางบัญชี</Label>
                  <Select
                    id="accounting_tax_tier"
                    disabled={formBusy}
                    {...register("accounting_tax_tier")}
                  >
                    {TAX_TIER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label htmlFor="reference_no">เลขอ้างอิง</Label>
                  <Input
                    id="reference_no"
                    type="text"
                    disabled={formBusy}
                    {...register("reference_no")}
                  />
                </div>

                <div>
                  <Label htmlFor="vehicle_plate">ทะเบียนรถ</Label>
                  <Input
                    id="vehicle_plate"
                    type="text"
                    placeholder="เช่น ขว 398 สข"
                    disabled={formBusy}
                    {...register("vehicle_plate")}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label>หมวดหมู่ค่าใช้จ่าย</Label>
                  <ExpenseCategoryCombobox
                    options={categories}
                    value={watchedCategoryId}
                    onChange={(id) =>
                      setValue("category_id", id, { shouldValidate: true })
                    }
                    onCategoryCreated={handleCategoryCreated}
                    disabled={formBusy}
                  />
                </div>

                <div>
                  <Label htmlFor="vat_type">ประเภทภาษี (VAT Type)</Label>
                  <Select
                    id="vat_type"
                    disabled={formBusy}
                    value={watchedVatType}
                    onChange={(e) => {
                      const next = e.target.value as ExpenseVatType;
                      setValue("vat_type", next, { shouldValidate: true });
                      syncAmountsFromBase(getValues("base_amount"), next);
                    }}
                  >
                    {EXPENSE_VAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="md:col-span-2 space-y-2">
                  <Label>รายการย่อยในบิล</Label>
                  {billLines.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      ยังไม่มีรายการ — สแกนบิลแล้วระบบจะเติมตารางให้อัตโนมัติ
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500">
                          <tr>
                            <th className="px-2 py-2">รายการ</th>
                            <th className="px-2 py-2">จำนวน</th>
                            <th className="px-2 py-2">หน่วย</th>
                            <th className="px-2 py-2">ราคา</th>
                            <th className="px-2 py-2">รวม</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billLines.map((line, index) => (
                            <tr key={`${line.description}-${index}`} className="border-t">
                              <td className="px-2 py-2">{line.description}</td>
                              <td className="px-2 py-2">{line.quantity}</td>
                              <td className="px-2 py-2">{line.unit_name || "-"}</td>
                              <td className="px-2 py-2">{line.unit_price.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                              <td className="px-2 py-2">{line.line_total.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="base_amount">{baseAmountLabel}</Label>
                  <Input
                    id="base_amount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    disabled={formBusy}
                    value={watchedBaseAmount}
                    onChange={(e) => {
                      const next = e.target.value;
                      setValue("base_amount", next, { shouldValidate: true });
                      syncAmountsFromBase(next, getValues("vat_type"));
                    }}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    {baseAmountHint}
                  </p>
                  {errors.base_amount ? (
                    <p className="mt-1 text-[11px] text-red-600">
                      กรุณาระบุจำนวนเงิน
                    </p>
                  ) : null}
                </div>

                <div>
                  <Label htmlFor="sub_total">ยอดก่อนภาษี (Sub Total)</Label>
                  <Input
                    id="sub_total"
                    type="text"
                    value={formatThaiBaht(watchedSubTotal ?? 0)}
                    disabled
                    readOnly
                    className="bg-slate-50"
                  />
                </div>

                <div>
                  <Label htmlFor="vat_amount">ภาษีมูลค่าเพิ่ม (VAT)</Label>
                  <Input
                    id="vat_amount"
                    type="text"
                    value={formatThaiBaht(watchedVatAmount ?? 0)}
                    disabled
                    readOnly
                    className="bg-slate-50"
                  />
                </div>

                <div>
                  <Label htmlFor="wht_type">หัก ณ ที่จ่าย (WHT Type)</Label>
                  <Select
                    id="wht_type"
                    disabled={formBusy}
                    value={watchedWhtType ?? ""}
                    onChange={(e) => {
                      const nextType = e.target.value;
                      setValue("wht_type", nextType, {
                        shouldValidate: true,
                      });
                      if (!nextType.trim()) {
                        setValue("wht_rate", 0, { shouldValidate: true });
                        return;
                      }
                      const selected = whtOptions.find(
                        (opt) => opt.value === nextType,
                      );
                      setValue(
                        "wht_rate",
                        selected
                          ? selected.rate
                          : resolvedDefaultWhtRate,
                        { shouldValidate: true },
                      );
                    }}
                  >
                    {whtOptions.map((option) => (
                      <option key={option.value || "none"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-slate-400">
                    WHT คำนวณจากยอดก่อนภาษี (Sub Total) × อัตรา{" "}
                    {resolveEffectiveWhtRate(
                      watchedWhtType,
                      watchedWhtRate,
                      resolvedDefaultWhtRate,
                    )}
                    %
                  </p>
                </div>

                {watchedWhtType?.trim() ? (
                  <div>
                    <Label htmlFor="wht_rate">อัตราหัก ณ ที่จ่าย (%)</Label>
                    <Input
                      id="wht_rate"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.01"
                      disabled={formBusy}
                      value={watchedWhtRate ?? resolvedDefaultWhtRate}
                      onChange={(e) => {
                        const next = roundMoney(Number(e.target.value));
                        setValue(
                          "wht_rate",
                          Number.isFinite(next) && next >= 0 ? next : 0,
                          { shouldValidate: true },
                        );
                      }}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      ค่าเริ่มต้นจาก Master Data — ปรับได้ตามประเภทหัก ณ ที่จ่าย
                    </p>
                  </div>
                ) : (
                  <div className="hidden md:block" aria-hidden />
                )}

                <div>
                  <Label htmlFor="wht_amount">ยอดหัก ณ ที่จ่าย (WHT)</Label>
                  <Input
                    id="wht_amount"
                    type="text"
                    value={formatThaiBaht(watchedWhtAmount ?? 0)}
                    disabled
                    readOnly
                    className="bg-slate-50 text-amber-800"
                  />
                </div>

                <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="grand_total"
                        className="text-slate-600"
                      >
                        ยอดรวมบิล (Grand Total)
                      </Label>
                      <Input
                        id="grand_total"
                        type="text"
                        value={formatThaiBaht(watchedGrandTotal ?? 0)}
                        disabled
                        readOnly
                        className="border-slate-200 bg-white font-semibold text-slate-800"
                      />
                      <p className="text-[11px] text-slate-400">
                        ยอดตามใบเสร็จ (Sub Total + VAT)
                      </p>
                    </div>
                    <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/90 p-3">
                      <Label
                        htmlFor="net_payable"
                        className="text-emerald-800"
                      >
                        ยอดโอนจ่ายจริง (Net Payable)
                      </Label>
                      <Input
                        id="net_payable"
                        type="text"
                        value={formatThaiBaht(watchedNetPayable ?? 0)}
                        disabled
                        readOnly
                        className="border-emerald-200 bg-white text-base font-bold text-emerald-900"
                      />
                      <p className="text-[11px] text-emerald-700/80">
                        Grand Total − WHT = เงินสดที่ต้องโอน
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="payment_method">วิธีการชำระ</Label>
                  <Select
                    id="payment_method"
                    disabled={formBusy}
                    value={watchedPaymentMethod}
                    onChange={(e) => {
                      const next = e.target.value as PaymentMethod;
                      setValue("payment_method", next, {
                        shouldValidate: true,
                      });
                      if (next !== "TRANSFER") {
                        setValue("bank_account_id", "", {
                          shouldValidate: true,
                        });
                      }
                    }}
                  >
                    {PAYMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>

                {watchedPaymentMethod === "TRANSFER" ? (
                  <div className="md:col-span-2">
                    <Label htmlFor="bank_account_id">
                      บัญชีธนาคาร (Bank Account)
                    </Label>
                    <Select
                      id="bank_account_id"
                      disabled={formBusy || bankAccounts.length === 0}
                      value={watchedBankAccountId}
                      onChange={(e) =>
                        setValue("bank_account_id", e.target.value, {
                          shouldValidate: true,
                        })
                      }
                    >
                      <option value="" disabled>
                        เลือกบัญชีธนาคารบริษัท
                      </option>
                      {bankAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}

                <div className="md:col-span-2 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={Boolean(watchedIsInstallment)}
                      disabled={formBusy}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setValue("is_installment", checked, {
                          shouldValidate: true,
                        });
                        if (checked && installmentFields.length === 0) {
                          appendInstallment({
                            installment_period: 1,
                            due_date: watchedExpenseDate || defaultDate,
                            principal_amount:
                              roundMoney(Number(watchedNetPayable ?? 0)) || 0,
                            interest_amount: 0,
                          });
                        }
                        if (!checked) {
                          replaceInstallments([]);
                        }
                      }}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">
                        เป็นการผ่อนชำระ (Installment Plan)
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        เมื่อเลือก จะบันทึกงวดลงตาราง{" "}
                        <code className="text-[10px]">expense_installments</code>
                      </span>
                    </span>
                  </label>

                  {watchedIsInstallment ? (
                    <div className="space-y-3">
                      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2">งวดที่</th>
                              <th className="px-3 py-2">วันครบกำหนด</th>
                              <th className="px-3 py-2 text-right">เงินต้น</th>
                              <th className="px-3 py-2 text-right">ดอกเบี้ย</th>
                              <th className="px-3 py-2 text-right">รวมงวด</th>
                              <th className="px-3 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {installmentFields.map((field, index) => {
                              const principal = Number(
                                watchedInstallments?.[index]?.principal_amount ??
                                  0,
                              );
                              const interest = Number(
                                watchedInstallments?.[index]?.interest_amount ??
                                  0,
                              );
                              return (
                                <tr
                                  key={field.id}
                                  className="border-t border-slate-100"
                                >
                                  <td className="px-3 py-2">
                                    <Input
                                      type="number"
                                      min={1}
                                      step={1}
                                      disabled={formBusy}
                                      className="h-9 w-20"
                                      {...register(
                                        `installments.${index}.installment_period`,
                                        { valueAsNumber: true },
                                      )}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      type="date"
                                      disabled={formBusy}
                                      className="h-9"
                                      {...register(
                                        `installments.${index}.due_date`,
                                      )}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      disabled={formBusy}
                                      className="h-9 text-right"
                                      {...register(
                                        `installments.${index}.principal_amount`,
                                        { valueAsNumber: true },
                                      )}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      disabled={formBusy}
                                      className="h-9 text-right"
                                      {...register(
                                        `installments.${index}.interest_amount`,
                                        { valueAsNumber: true },
                                      )}
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-700">
                                    {formatThaiBaht(
                                      roundMoney(principal + interest),
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="text-red-600"
                                      disabled={
                                        formBusy || installmentFields.length <= 1
                                      }
                                      onClick={() => removeInstallment(index)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1 text-xs">
                          <p
                            className={cn(
                              "font-semibold",
                              principalMatchesNetPayable
                                ? "text-emerald-700"
                                : "text-red-600",
                            )}
                          >
                            เงินต้นรวม {formatThaiBaht(installmentPrincipalTotal)}{" "}
                            {principalMatchesNetPayable ? "=" : "≠"} Net Payable{" "}
                            {formatThaiBaht(netPayableAmount)}
                          </p>
                          <p
                            className={cn(
                              "font-medium",
                              installmentTotalsMatchNetPayable
                                ? "text-emerald-700"
                                : "text-red-600",
                            )}
                          >
                            เงินต้น + ดอกเบี้ย{" "}
                            {formatThaiBaht(installmentCombinedTotal)}{" "}
                            {installmentTotalsMatchNetPayable ? "=" : "≠"} Net
                            Payable {formatThaiBaht(netPayableAmount)}
                            <span className="ml-1 font-normal text-slate-500">
                              (ดอกเบี้ย{" "}
                              {formatThaiBaht(installmentInterestTotal)})
                            </span>
                          </p>
                          {!installmentTotalsMatchNetPayable ? (
                            <p className="text-red-600">
                              ปรับยอดเงินต้น/ดอกเบี้ยให้ผลรวมเท่ากับ Net Payable
                              ก่อนบันทึก
                            </p>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={formBusy}
                          onClick={() =>
                            appendInstallment({
                              installment_period:
                                installmentFields.length + 1,
                              due_date: watchedExpenseDate || defaultDate,
                              principal_amount: 0,
                              interest_amount: 0,
                            })
                          }
                        >
                          <Plus className="h-4 w-4" />
                          เพิ่มงวด
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="md:col-span-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <Label className="text-sm font-semibold text-slate-800">
                        สลิปโอนเงิน (Payment Slip){" "}
                        <span className="font-normal text-slate-400">
                          (Optional / ไม่บังคับ)
                        </span>
                      </Label>
                      <p className="text-[11px] text-slate-400">
                        แนบหลักฐานการโอน — อัปโหลดเมื่อบันทึก Draft ไปยัง{" "}
                        <code className="text-[10px]">expense_documents</code>
                      </p>
                    </div>
                    {(watchedPaymentSlipFile || watchedPaymentSlipUrl) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={formBusy}
                        onClick={clearPaymentSlip}
                      >
                        <X className="h-4 w-4" />
                        ลบสลิป
                      </Button>
                    )}
                  </div>
                  <input
                    ref={paymentSlipInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.pdf"
                    className="sr-only"
                    disabled={formBusy}
                    onChange={(e) => {
                      void setPaymentSlipFile(e.target.files?.[0] ?? null);
                    }}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center transition",
                      "hover:border-emerald-400 hover:bg-emerald-50/40",
                      formBusy && "pointer-events-none opacity-70",
                    )}
                    onClick={() => paymentSlipInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        paymentSlipInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      void setPaymentSlipFile(e.dataTransfer.files?.[0] ?? null);
                    }}
                  >
                    {paymentSlipPreviewUrl ? (
                      <div className="w-full max-w-sm space-y-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={paymentSlipPreviewUrl}
                          alt="ตัวอย่างสลิปโอนเงิน"
                          className="mx-auto max-h-40 rounded-xl border border-slate-200 object-contain shadow-sm"
                        />
                        <Badge variant="blue">
                          {watchedPaymentSlipFile instanceof File
                            ? watchedPaymentSlipFile.name
                            : "สลิปที่แนบไว้"}
                        </Badge>
                      </div>
                    ) : watchedPaymentSlipFile instanceof File ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 shadow-sm">
                          <FileText className="h-5 w-5" />
                        </div>
                        <Badge variant="blue">
                          {watchedPaymentSlipFile.name}
                        </Badge>
                        <p className="text-xs text-slate-500">
                          ไฟล์ PDF — จะอัปโหลดเมื่อบันทึก Draft
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 shadow-sm">
                          <ImagePlus className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-800">
                            ลากวางสลิปโอนเงิน หรือคลิกเพื่อเลือกไฟล์
                          </p>
                          <p className="text-xs text-slate-500">
                            JPG / PNG / WEBP / PDF (สูงสุด 10MB) · ไม่บังคับ
                          </p>
                        </div>
                        <Badge variant="slate">ยังไม่ได้แนบสลิป</Badge>
                      </>
                    )}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <Label htmlFor="remark">หมายเหตุ</Label>
                  <Textarea
                    id="remark"
                    rows={3}
                    placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                    disabled={formBusy}
                    {...register("remark")}
                  />
                </div>
              </CardContent>
            </Card>

            {fields.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    รายการจาก OCR ({fields.length})
                  </CardTitle>
                  <CardDescription>
                    ตรวจทานรายการที่ AI อ่านได้ — ยอดรวมใช้จากหัวบิลด้านบนเมื่อบันทึก
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 md:grid-cols-12"
                    >
                      <div className="md:col-span-6">
                        <Label htmlFor={`items.${index}.description`}>
                          รายละเอียด
                        </Label>
                        <Input
                          id={`items.${index}.description`}
                          disabled={formBusy}
                          {...register(`items.${index}.description` as const)}
                        />
                      </div>
                      <div className="md:col-span-3">
                        <Label htmlFor={`items.${index}.amount`}>จำนวนเงิน</Label>
                        <Input
                          id={`items.${index}.amount`}
                          type="number"
                          step="0.01"
                          min={0}
                          disabled={formBusy}
                          {...register(`items.${index}.amount` as const, {
                            valueAsNumber: true,
                          })}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label htmlFor={`items.${index}.category_hint`}>
                          Category
                        </Label>
                        <Input
                          id={`items.${index}.category_hint`}
                          disabled={formBusy}
                          {...register(
                            `items.${index}.category_hint` as const,
                          )}
                        />
                      </div>
                      <div className="flex items-end md:col-span-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={formBusy}
                          aria-label="ลบรายการ"
                          onClick={() => {
                            const next = getValues("items").filter(
                              (_, i) => i !== index,
                            );
                            replace(next);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Link
                href={cancelHref}
                className={cn(
                  "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50",
                  formBusy && "pointer-events-none opacity-50",
                )}
              >
                <ArrowLeft className="h-4 w-4" />
                Cancel
              </Link>
              <Button
                type="submit"
                disabled={
                  formBusy ||
                  categories.length === 0 ||
                  vendorChoices.length === 0 ||
                  installmentSubmitBlocked
                }
                aria-busy={isSubmitting}
                aria-disabled={formBusy || installmentSubmitBlocked}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {DOCUMENT_ACTIONS.SAVE_DRAFT}
              </Button>
            </div>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      {!isEdit && tab === "ocr" ? (
        <div className="flex justify-end">
          <Link
            href={cancelHref}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50",
              formBusy && "pointer-events-none opacity-50",
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </Link>
        </div>
      ) : null}
    </div>
  );
}
