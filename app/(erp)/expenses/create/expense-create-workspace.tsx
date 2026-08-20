"use client";

/**
 * Phase 8 — Expense create workspace (Client island for Tabs + form state).
 * Categories / vendors / bank accounts come from Server Component parent.
 * OCR goes through Server Action `processExpenseOCR` only (Zero Client-Side Fetching).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Save,
  Sparkles,
  PenLine,
  ScanLine,
  Trash2,
  Paperclip,
  X,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import {
  createDraftExpense,
  updateDraftExpense,
} from "@/app/actions/expenses";
import {
  DUPLICATE_INVOICE_ERROR,
  DUPLICATE_INVOICE_MESSAGE,
  EXPENSE_WHT_OPTIONS,
} from "@/lib/constants/expense-constants";
import type {
  ExpenseBankAccountOption,
  ExpenseCategory,
  ExpenseVendorOption,
} from "@/types/expense";
import { processExpenseOCR } from "@/app/actions/expense/ocr-action";
import type { ExpenseOcrExtraction } from "@/types/expense";
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
import { VAT_OPTIONS, type VatOptionValue } from "@/lib/constants/accounting";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import { cn } from "@/lib/utils";
import { compressImage, compressImageForOcr } from "@/lib/utils/image-compression";
import { ExpenseCategoryCombobox } from "./expense-category-combobox";

export type ExpenseCreateTab = "ocr" | "manual";

export type ExpenseVatType = VatOptionValue;

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

/** RHF form shape — includes OCR-mapped fields + save payload fields. */
export type ExpenseFormValues = {
  expense_date: string;
  vendor_id: string;
  vendor_name: string;
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
};

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "เงินสด (Cash)" },
  { value: "TRANSFER", label: "โอนเงิน (Transfer)" },
];

const CATEGORY_HINT_TO_NAMES: Record<string, string[]> = {
  TRANSPORT: ["ค่าขนส่ง"],
  UTILITIES: ["ค่าน้ำ-ไฟ", "ค่าน้ำ", "ค่าไฟ"],
  OFFICE_SUPPLY: ["ค่าวัสดุสิ้นเปลือง"],
  MAINTENANCE: ["ค่าใช้จ่ายสำนักงาน"],
  SALARY: ["เงินเดือน"],
  OTHER: ["อื่นๆ"],
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

function parseAmount(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
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

/** Resolve WHT preset from stored type/rate (edit mode). */
function resolveExpenseWht(
  whtType: string | null | undefined,
  whtRate: number | null | undefined,
): { type: string; rate: number } {
  const type = (whtType ?? "").trim();
  if (type) {
    const byType = EXPENSE_WHT_OPTIONS.find((opt) => opt.value === type);
    if (byType) return { type: byType.value, rate: byType.rate };
  }

  const rate = roundMoney(Number(whtRate ?? 0));
  if (rate > 0) {
    const byRate = EXPENSE_WHT_OPTIONS.find(
      (opt) => Math.abs(opt.rate - rate) < 0.001,
    );
    if (byRate) return { type: byRate.value, rate: byRate.rate };
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
  extraction: ExpenseOcrExtraction,
  existingRemark: string,
): string {
  const parts: string[] = [];
  if (extraction.document_number) {
    parts.push(`เลขที่เอกสาร: ${extraction.document_number}`);
  }
  if (extraction.tax_id) {
    parts.push(`Tax ID: ${extraction.tax_id}`);
  }
  if (extraction.items.length > 0) {
    const lines = extraction.items
      .filter((item) => item.description.trim())
      .map(
        (item) =>
          `- ${item.description}${item.amount ? ` (${formatThaiBaht(item.amount)})` : ""}`,
      );
    if (lines.length > 0) {
      parts.push(`รายการ OCR:\n${lines.join("\n")}`);
    }
  }

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
  mode = "create",
  expenseId,
  documentNo,
  initialValues,
}: ExpenseCreateWorkspaceProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const cancelHref = isEdit && expenseId ? `/expenses/${expenseId}` : "/expenses";

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

  const [tab, setTab] = useState<ExpenseCreateTab>(
    isEdit ? "manual" : defaultTab,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrFileName, setOcrFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] =
    useState<ExpenseCategory[]>(initialCategories);

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

  // Client-side WHT math — Sub Total × rate; Net Payable = Grand Total − WHT
  useEffect(() => {
    const { whtAmount, netPayable } = calculateExpenseWht(
      Number(watchedSubTotal ?? 0),
      Number(watchedWhtRate ?? 0),
      Number(watchedGrandTotal ?? 0),
    );
    setValue("wht_amount", whtAmount, { shouldValidate: true });
    setValue("net_payable", netPayable, { shouldValidate: true });
  }, [watchedSubTotal, watchedWhtRate, watchedGrandTotal, setValue]);

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

  const vendorOptions = useMemo(
    () =>
      vendors.map((vendor) => ({
        id: vendor.id,
        company_name: vendor.company_name,
      })),
    [vendors],
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

  function applyOcrResult(extraction: ExpenseOcrExtraction) {
    const vatType = extraction.vat_type;
    const matchedVendorId = matchVendorId(extraction.vendor_name, vendors);
    const primaryHint =
      extraction.items.find((i) => i.category_hint)?.category_hint ?? "OTHER";
    const matchedCategoryId = matchCategoryId(primaryHint, categories);

    const baseAmount =
      vatType === "INCLUSIVE"
        ? String(extraction.grand_total || extraction.sub_total)
        : String(extraction.sub_total || extraction.grand_total);

    const docDate = extraction.document_date || getValues("expense_date");
    const current = getValues();
    const nextItems = extraction.items.map((item) => ({
      description: item.description,
      amount: item.amount,
      category_hint: item.category_hint || "OTHER",
    }));

    reset(
      {
        ...current,
        vendor_name: extraction.vendor_name ?? "",
        vendor_id: matchedVendorId || current.vendor_id,
        document_number: extraction.document_number ?? "",
        document_date: docDate,
        expense_date: docDate,
        category_id: matchedCategoryId || current.category_id,
        vat_type: vatType,
        sub_total: extraction.sub_total,
        vat_amount: extraction.vat_amount,
        grand_total: extraction.grand_total,
        base_amount: baseAmount,
        items: nextItems.length > 0 ? nextItems : current.items,
        remark: buildOcrRemark(extraction, current.remark),
      },
      { keepDefaultValues: false },
    );

    console.log("[Expense OCR] applied to form:", {
      vendor_name: extraction.vendor_name,
      document_number: extraction.document_number,
      document_date: docDate,
      grand_total: extraction.grand_total,
      item_count: nextItems.length,
    });
  }

  async function runExpenseOcr(file: File | null | undefined) {
    if (!file || file.size === 0) {
      toast.error("กรุณาเลือกไฟล์รูปบิลก่อน");
      return;
    }

    const mime = (file.type || "").toLowerCase();
    if (
      mime &&
      !mime.startsWith("image/") &&
      mime !== "application/octet-stream"
    ) {
      toast.error("รองรับเฉพาะไฟล์รูปภาพ (.jpg, .png)");
      return;
    }

    setIsOcrProcessing(true);
    setError(null);
    setOcrFileName(file.name);

    try {
      let uploadFile: File;
      try {
        uploadFile = await compressImageForOcr(file);
      } catch (compressErr) {
        console.error("[Expense OCR] compressImageForOcr failed:", compressErr);
        const msg =
          compressErr instanceof Error
            ? `บีบอัดรูปไม่สำเร็จ: ${compressErr.message}`
            : "บีบอัดรูปไม่สำเร็จ — กรุณาลองใช้รูปที่เล็กลง";
        setError(msg);
        toast.error(msg);
        return;
      }

      // Keep compressed file as Manual attachment (upload on Save Draft)
      void setAttachmentFile(uploadFile);

      const formData = new FormData();
      formData.append("file", uploadFile);

      const result = await processExpenseOCR(formData);

      if (!result.success) {
        console.error("[Expense OCR] processExpenseOCR failed:", result.error);
        setError(result.error);
        toast.error(result.error);
        return;
      }

      if (!isEdit) {
        setTab("manual");
        // Sync URL without Next.js navigation — router.replace remounts the
        // workspace and wipes RHF state set by applyOcrResult.
        window.history.replaceState(null, "", tabHref("manual"));
      }

      applyOcrResult(result.data);
      toast.success("อ่านบิลสำเร็จ — ตรวจสอบข้อมูลก่อนบันทึก Draft");
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

    try {
      // Prefer ref (authoritative) — RHF File fields are unreliable on submit.
      const receiptFile =
        attachmentFileRef.current instanceof File
          ? attachmentFileRef.current
          : values.attachment_file instanceof File
            ? values.attachment_file
            : null;

      const formData = new FormData();
      formData.append("category_id", values.category_id);
      formData.append("vendor_id", values.vendor_id);
      formData.append("expense_date", values.expense_date);
      formData.append("net_amount", String(values.sub_total));
      formData.append("vat_amount", String(values.vat_amount));
      formData.append("wht_type", values.wht_type.trim());
      formData.append("wht_rate", String(values.wht_rate));
      formData.append("wht_amount", String(values.wht_amount));
      formData.append("net_payable", String(values.net_payable));
      formData.append("payment_method", values.payment_method);
      formData.append(
        "bank_account_id",
        values.payment_method === "TRANSFER" ? values.bank_account_id : "",
      );
      formData.append("remark", values.remark.trim());
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
      {categoriesError || vendorsError || bankAccountsError ? (
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
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={handleTabChange} className="space-y-5">
        {isEdit ? null : (
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
        )}

        {isEdit ? null : (
          <TabsContent value="ocr">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  Smart OCR
                </CardTitle>
                <CardDescription>
                  อัปโหลดรูปใบเสร็จ — Server Action เรียก Edge Function{" "}
                  <code className="text-xs">ocr-expense</code> แล้ว prefills
                  ฟอร์ม Manual ให้ตรวจทาน
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
                        : "ลากวางรูปใบเสร็จที่นี่ หรือคลิกเพื่อเลือกไฟล์"}
                    </p>
                    <p className="text-xs text-slate-500">
                      รองรับ JPG / PNG / WEBP
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
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png"
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
            className="space-y-5"
          >
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
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png"
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
                    : "บันทึกค่าใช้จ่าย (Manual)"}
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
                    เลขที่บิลผู้จำหน่าย (Vendor Doc No)
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
                        vendors.find((v) => v.id === id)?.company_name ?? "";
                      setValue("vendor_name", name, { shouldValidate: true });
                    }}
                    disabled={formBusy || vendors.length === 0}
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
                    {VAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
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
                      const option =
                        EXPENSE_WHT_OPTIONS.find(
                          (row) => row.value === nextType,
                        ) ?? EXPENSE_WHT_OPTIONS[0];
                      setValue("wht_type", option.value, {
                        shouldValidate: true,
                      });
                      setValue("wht_rate", option.rate, {
                        shouldValidate: true,
                      });
                    }}
                  >
                    {EXPENSE_WHT_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-slate-400">
                    WHT คำนวณจากยอดก่อนภาษี (Sub Total) × อัตรา{" "}
                    {Number(watchedWhtRate ?? 0)}%
                  </p>
                </div>

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
                  vendors.length === 0
                }
                aria-busy={isSubmitting}
                aria-disabled={formBusy}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {DOCUMENT_ACTIONS.SAVE_DRAFT}
              </Button>
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
