"use client";

/**
 * Phase 8 — Expense create workspace (Client island for Tabs + form state).
 * Categories / vendors / bank accounts come from Server Component parent.
 * Zero Client-Side Fetching for master data.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Save,
  Sparkles,
  PenLine,
} from "lucide-react";
import { toast } from "sonner";
import {
  createDraftExpense,
  updateDraftExpense,
  type ExpenseBankAccountOption,
  type ExpenseCategory,
  type ExpenseVendorOption,
} from "@/app/actions/expenses";
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
  payment_method: string | null;
  bank_account_id: string | null;
  remark: string | null;
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

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "เงินสด (Cash)" },
  { value: "TRANSFER", label: "โอนเงิน (Transfer)" },
];

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

  // Prefer EXCLUSIVE when VAT exists but ratios are ambiguous
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

  // INCLUSIVE — inputted base IS grand total
  const vat = roundMoney((base * 7) / 107);
  const net = roundMoney(base - vat);
  return { net, vat, grand: base };
}

function tabHref(tab: ExpenseCreateTab): string {
  return `/expenses/create?tab=${tab}`;
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

  const [tab, setTab] = useState<ExpenseCreateTab>(
    isEdit ? "manual" : defaultTab,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Sync lock — blocks double-submit before React re-renders `isSubmitting`. */
  const submitLockRef = useRef(false);

  const [categories, setCategories] =
    useState<ExpenseCategory[]>(initialCategories);
  const [expenseDate, setExpenseDate] = useState(
    initialValues?.expense_date || defaultDate,
  );
  const [vendorId, setVendorId] = useState(initialValues?.vendor_id ?? "");
  const [categoryId, setCategoryId] = useState(
    initialValues?.category_id || initialCategories[0]?.id || "",
  );
  const [baseAmount, setBaseAmount] = useState(
    initialValues
      ? resolveBaseAmountInput(initialValues, inferredVatType)
      : "",
  );
  const [vatType, setVatType] = useState<ExpenseVatType>(inferredVatType);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>(initialPayment);
  const [bankAccountId, setBankAccountId] = useState(
    initialValues?.bank_account_id ?? "",
  );
  const [remark, setRemark] = useState(initialValues?.remark ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ocrFileName, setOcrFileName] = useState<string | null>(null);

  const amounts = useMemo(
    () => calculateExpenseAmounts(parseAmount(baseAmount), vatType),
    [baseAmount, vatType],
  );

  const vendorOptions = useMemo(
    () =>
      vendors.map((vendor) => ({
        id: vendor.id,
        company_name: vendor.company_name,
      })),
    [vendors],
  );

  const baseAmountLabel =
    vatType === "INCLUSIVE"
      ? "จำนวนเงินรวมภาษี (Grand Total)"
      : vatType === "EXCLUSIVE"
        ? "ยอดก่อนภาษี (Net Amount)"
        : "จำนวนเงิน (Base Amount)";

  const baseAmountHint =
    vatType === "INCLUSIVE"
      ? "กรอกยอดรวม VAT แล้ว — ระบบจะถอด Net / VAT ให้"
      : vatType === "EXCLUSIVE"
        ? "กรอกยอดก่อน VAT — ระบบจะบวก VAT 7% ให้"
        : "ไม่มี VAT — Net = Grand = จำนวนที่กรอก";

  function handleTabChange(next: string) {
    if (isEdit) return;
    const value: ExpenseCreateTab = next === "manual" ? "manual" : "ocr";
    setTab(value);
    router.replace(tabHref(value), { scroll: false });
  }

  function handleOcrFiles(files: FileList | null) {
    const file = files?.[0] ?? null;
    setOcrFileName(file ? file.name : null);
  }

  function handleCategoryCreated(category: ExpenseCategory) {
    setCategories((prev) => {
      if (prev.some((row) => row.id === category.id)) return prev;
      return [...prev, category].sort((a, b) =>
        a.category_name.localeCompare(b.category_name, "th"),
      );
    });
  }

  async function handleSaveDraft(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();

    // Hard lock first (sync) — prevents duplicate drafts from double-click /
    // Enter-before-re-render. React state alone is not enough.
    if (submitLockRef.current || isSubmitting) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(null);

    const unlock = () => {
      submitLockRef.current = false;
      setIsSubmitting(false);
    };

    if (!vendorId) {
      const msg = "กรุณาเลือกผู้ให้บริการ (Vendor)";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (!categoryId) {
      const msg = "กรุณาเลือกหมวดหมู่ค่าใช้จ่าย";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (!expenseDate) {
      const msg = "กรุณาระบุวันที่เกิดค่าใช้จ่าย";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (!baseAmount || parseAmount(baseAmount) < 0) {
      const msg = "กรุณาระบุจำนวนเงินให้ถูกต้อง";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }
    if (paymentMethod === "TRANSFER" && !bankAccountId) {
      const msg = "กรุณาเลือกบัญชีธนาคารเมื่อชำระแบบโอนเงิน";
      setError(msg);
      toast.error(msg);
      unlock();
      return;
    }

    try {
      const payload = {
        category_id: categoryId,
        vendor_id: vendorId,
        expense_date: expenseDate,
        net_amount: amounts.net,
        vat_amount: amounts.vat,
        payment_method: paymentMethod,
        bank_account_id:
          paymentMethod === "TRANSFER" ? bankAccountId : null,
        remark: remark.trim() || null,
      };

      const result =
        isEdit && expenseId
          ? await updateDraftExpense(expenseId, payload)
          : await createDraftExpense(payload);

      if (result.error || !result.data?.id) {
        const msg =
          result.error ??
          (isEdit ? "อัปเดต Draft ไม่สำเร็จ" : "บันทึก Draft ไม่สำเร็จ");
        setError(msg);
        toast.error(msg);
        unlock();
        return;
      }

      const id = result.data.id;
      toast.success(
        isEdit
          ? `อัปเดต Draft ${result.data.document_no} สำเร็จ`
          : `บันทึก Draft ${result.data.document_no} สำเร็จ`,
      );

      // Immediate redirect to detail — keep lock engaged during navigation so
      // the green/primary button cannot fire a second createDraftExpense.
      router.push("/expenses/" + id);
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
            <TabsTrigger value="ocr" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              สแกนบิลด้วย AI (Smart OCR)
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1.5">
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
                  อัปโหลดรูปใบเสร็จ — จะเชื่อม Gemini Vision Edge Function ในขั้นถัดไป
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label
                  htmlFor="expense-ocr-upload"
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/80 px-6 py-14 text-center transition",
                    "hover:border-blue-400 hover:bg-blue-50/40",
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleOcrFiles(e.dataTransfer.files);
                  }}
                >
                  <div className="grid size-14 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm">
                    <ImagePlus className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-800">
                      ลากวางรูปใบเสร็จที่นี่ หรือคลิกเพื่อเลือกไฟล์
                    </p>
                    <p className="text-xs text-slate-500">
                      รองรับ JPG / PNG / WEBP / PDF (placeholder — ยังไม่ประมวลผล AI)
                    </p>
                  </div>
                  {ocrFileName ? (
                    <Badge variant="blue">{ocrFileName}</Badge>
                  ) : (
                    <Badge variant="slate">ยังไม่ได้เลือกไฟล์</Badge>
                  )}
                  <input
                    id="expense-ocr-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="sr-only"
                    onChange={(e) => handleOcrFiles(e.target.files)}
                  />
                </label>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="manual">
          <form onSubmit={handleSaveDraft} className="space-y-5">
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
                    : "Combobox ค้นหาได้ · VAT คำนวณอัตโนมัติ · Late Numbering DRAFT"}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="expense_date">วันที่เกิดค่าใช้จ่าย</Label>
                  <Input
                    id="expense_date"
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <Label>ผู้ให้บริการ (Vendor)</Label>
                  <VendorCombobox
                    options={vendorOptions}
                    value={vendorId}
                    onChange={setVendorId}
                    disabled={isSubmitting || vendors.length === 0}
                    placeholder="ค้นหาและเลือกผู้ให้บริการ..."
                    emptyMessage="ไม่พบผู้ให้บริการ"
                  />
                </div>

                <div className="md:col-span-2">
                  <Label>หมวดหมู่ค่าใช้จ่าย</Label>
                  <ExpenseCategoryCombobox
                    options={categories}
                    value={categoryId}
                    onChange={setCategoryId}
                    onCategoryCreated={handleCategoryCreated}
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <Label htmlFor="vat_type">ประเภทภาษี (VAT Type)</Label>
                  <Select
                    id="vat_type"
                    value={vatType}
                    onChange={(e) =>
                      setVatType(e.target.value as ExpenseVatType)
                    }
                    disabled={isSubmitting}
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
                    value={baseAmount}
                    onChange={(e) => setBaseAmount(e.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    {baseAmountHint}
                  </p>
                </div>

                <div>
                  <Label htmlFor="vat_amount">ภาษีมูลค่าเพิ่ม (VAT)</Label>
                  <Input
                    id="vat_amount"
                    type="text"
                    value={formatThaiBaht(amounts.vat)}
                    disabled
                    readOnly
                    className="bg-slate-50"
                  />
                </div>

                <div>
                  <Label htmlFor="grand_total">ยอดรวมสุทธิ (Grand Total)</Label>
                  <Input
                    id="grand_total"
                    type="text"
                    value={formatThaiBaht(amounts.grand)}
                    disabled
                    readOnly
                    className="bg-slate-50 font-semibold"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Net ที่จะบันทึก: {formatThaiBaht(amounts.net)}
                  </p>
                </div>

                <div>
                  <Label htmlFor="payment_method">วิธีการชำระ</Label>
                  <Select
                    id="payment_method"
                    value={paymentMethod}
                    onChange={(e) => {
                      const next = e.target.value as PaymentMethod;
                      setPaymentMethod(next);
                      if (next !== "TRANSFER") setBankAccountId("");
                    }}
                    disabled={isSubmitting}
                  >
                    {PAYMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>

                {paymentMethod === "TRANSFER" ? (
                  <div className="md:col-span-2">
                    <Label htmlFor="bank_account_id">
                      บัญชีธนาคาร (Bank Account)
                    </Label>
                    <Select
                      id="bank_account_id"
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
                      required
                      disabled={isSubmitting || bankAccounts.length === 0}
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

                <div className="md:col-span-2">
                  <Label htmlFor="remark">หมายเหตุ</Label>
                  <Textarea
                    id="remark"
                    rows={3}
                    placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </CardContent>
            </Card>

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
                  isSubmitting && "pointer-events-none opacity-50",
                )}
              >
                <ArrowLeft className="h-4 w-4" />
                Cancel
              </Link>
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  categories.length === 0 ||
                  vendors.length === 0
                }
                aria-busy={isSubmitting}
                aria-disabled={isSubmitting}
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
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </Link>
        </div>
      ) : null}
    </div>
  );
}
