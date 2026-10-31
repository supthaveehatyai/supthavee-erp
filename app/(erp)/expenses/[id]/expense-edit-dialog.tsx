"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateExpenseDirectAction } from "@/app/(erp)/expenses/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const CATEGORY_PRESETS = [
  "ค่าสาธารณูปโภค (น้ำ/ไฟ/เน็ต)",
  "ค่าน้ำมันเชื้อเพลิงและยานพาหนะ",
  "ค่าขนส่งและเดินทาง",
  "ค่าวัสดุและอุปกรณ์สำนักงาน",
  "ค่าซ่อมแซมและบำรุงรักษา",
  "ค่ารับรองและสวัสดิการ",
  "ค่าธรรมเนียมและภาษี",
  "ค่าจ้างและเงินเดือน",
] as const;

const CUSTOM_CATEGORY = "อื่นๆ";

type TaxMode = "INCLUSIVE" | "EXCLUSIVE" | "NO_VAT";
type PaymentMethod = "CASH" | "TRANSFER" | "CREDIT";

export type ExpenseEditDialogProps = {
  expenseId: string;
  expenseDate: string;
  categoryLabel: string;
  vendorName: string;
  vendorTaxId: string;
  taxInvoiceNo: string;
  taxType: string;
  netAmount: number;
  vatAmount: number;
  whtAmount: number;
  paymentMethod: string;
  bankAccountId: string;
  remark: string;
  receiptUrl: string;
  paymentSlipUrl: string;
  categories: string[];
  bankAccounts: { id: string; label: string }[];
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function splitInclusive(total: number): { net: number; vat: number } {
  const gross = roundMoney(total);
  const net = roundMoney(gross / 1.07);
  return { net, vat: roundMoney(gross - net) };
}

function asTaxMode(value: string, net: number, vat: number): TaxMode {
  const normalized = value.trim().toUpperCase();
  if (normalized === "EXCLUSIVE") return "EXCLUSIVE";
  if (normalized === "NO_VAT" || normalized === "NONE") return "NO_VAT";
  if (normalized === "INCLUSIVE") return "INCLUSIVE";
  if (vat <= 0) return "NO_VAT";
  const split = splitInclusive(net + vat);
  if (Math.abs(split.net - net) <= 0.02) return "INCLUSIVE";
  return "EXCLUSIVE";
}

function asPaymentMethod(value: string): PaymentMethod {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CASH" || normalized === "CREDIT") return normalized;
  return "TRANSFER";
}

function DropBox({
  label,
  hint,
  fileName,
  dragging,
  onFile,
}: {
  label: string;
  hint: string;
  fileName: string;
  dragging: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-4 text-center text-sm transition",
        dragging
          ? "border-blue-500 bg-blue-50/60 text-blue-800 ring-2 ring-blue-200"
          : "border-slate-300 bg-slate-50 text-slate-600",
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = event.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <span className="font-semibold text-slate-800">{label}</span>
      <span className="mt-1 text-xs">{fileName || hint}</span>
    </label>
  );
}

export function ExpenseEditDialog(props: ExpenseEditDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draggingReceipt, setDraggingReceipt] = useState(false);
  const [draggingSlip, setDraggingSlip] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);

  const categoryOptions = useMemo(() => {
    const names = new Set<string>(CATEGORY_PRESETS);
    for (const name of props.categories) {
      const trimmed = name.trim();
      if (trimmed) names.add(trimmed);
    }
    return Array.from(names);
  }, [props.categories]);

  const initialCategory = props.categoryLabel.trim();
  const categoryIsKnown = categoryOptions.includes(initialCategory);
  const [categoryChoice, setCategoryChoice] = useState(
    categoryIsKnown ? initialCategory : initialCategory ? CUSTOM_CATEGORY : "",
  );
  const [customCategory, setCustomCategory] = useState(
    categoryIsKnown ? "" : initialCategory,
  );
  const [expenseDate, setExpenseDate] = useState(props.expenseDate.slice(0, 10));
  const [taxInvoiceNo, setTaxInvoiceNo] = useState(props.taxInvoiceNo);
  const [vendorName, setVendorName] = useState(
    props.vendorName === "—" ? "" : props.vendorName,
  );
  const [vendorTaxId, setVendorTaxId] = useState(props.vendorTaxId);
  const initialTaxMode = asTaxMode(props.taxType, props.netAmount, props.vatAmount);
  const initialGross = roundMoney(props.netAmount + props.vatAmount);
  const initialSplit =
    initialTaxMode === "INCLUSIVE" ? splitInclusive(initialGross) : null;
  const [taxMode, setTaxMode] = useState<TaxMode>(initialTaxMode);
  const [gross, setGross] = useState(initialGross);
  const [netAmount, setNetAmount] = useState(initialSplit?.net ?? props.netAmount);
  const [vatAmount, setVatAmount] = useState(
    initialTaxMode === "NO_VAT" ? 0 : (initialSplit?.vat ?? props.vatAmount),
  );
  const [whtAmount, setWhtAmount] = useState(props.whtAmount);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    asPaymentMethod(props.paymentMethod),
  );
  const [bankAccountId, setBankAccountId] = useState(props.bankAccountId);
  const [remark, setRemark] = useState(props.remark === "—" ? "" : props.remark);

  useEffect(() => {
    if (!open) return;
    const preventBrowserFileOpen = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener("dragover", preventBrowserFileOpen);
    window.addEventListener("drop", preventBrowserFileOpen);
    return () => {
      window.removeEventListener("dragover", preventBrowserFileOpen);
      window.removeEventListener("drop", preventBrowserFileOpen);
    };
  }, [open]);

  function applyTaxMode(next: TaxMode, nextGross = gross, nextNet = netAmount) {
    setTaxMode(next);
    if (next === "INCLUSIVE") {
      const split = splitInclusive(nextGross > 0 ? nextGross : nextNet);
      setGross(nextGross > 0 ? roundMoney(nextGross) : roundMoney(split.net + split.vat));
      setNetAmount(split.net);
      setVatAmount(split.vat);
      return;
    }
    if (next === "NO_VAT") {
      setVatAmount(0);
      setGross(roundMoney(nextNet));
      return;
    }
    const vat = roundMoney(nextNet * 0.07);
    setVatAmount(vat);
    setGross(roundMoney(nextNet + vat));
  }

  function onInclusiveGrossChange(value: string) {
    const total = Number(value);
    const safe = Number.isFinite(total) && total >= 0 ? total : 0;
    setGross(safe);
    const split = splitInclusive(safe);
    setNetAmount(split.net);
    setVatAmount(split.vat);
  }

  function onNetChange(value: string) {
    const nextNet = Number(value);
    const safe = Number.isFinite(nextNet) && nextNet >= 0 ? nextNet : 0;
    setNetAmount(safe);
    if (taxMode === "EXCLUSIVE") {
      const vat = roundMoney(safe * 0.07);
      setVatAmount(vat);
      setGross(roundMoney(safe + vat));
      return;
    }
    if (taxMode === "NO_VAT") {
      setVatAmount(0);
      setGross(roundMoney(safe));
    }
  }

  const grandTotal = roundMoney(netAmount + vatAmount);
  const categoryName =
    categoryChoice === CUSTOM_CATEGORY ? customCategory.trim() : categoryChoice.trim();

  function onSave() {
    if (pending) return;
    const formData = new FormData();
    formData.set("expense_id", props.expenseId);
    formData.set("expense_date", expenseDate);
    formData.set("category_name", categoryName);
    formData.set("tax_invoice_no", taxInvoiceNo.trim());
    formData.set("vendor_name", vendorName.trim());
    formData.set("vendor_tax_id", vendorTaxId.trim());
    formData.set("tax_type", taxMode);
    formData.set("net_amount", String(netAmount));
    formData.set("vat_amount", String(vatAmount));
    formData.set("wht_amount", String(whtAmount));
    formData.set("total_amount", String(taxMode === "INCLUSIVE" ? gross : grandTotal));
    formData.set("payment_method", paymentMethod);
    formData.set("bank_account_id", paymentMethod === "CASH" ? "" : bankAccountId);
    formData.set("remark", remark.trim());
    if (props.receiptUrl) formData.set("receipt_url", props.receiptUrl);
    if (props.paymentSlipUrl) formData.set("payment_slip_url", props.paymentSlipUrl);
    if (receiptFile) formData.set("receipt_file", receiptFile);
    if (slipFile) formData.set("payment_slip_file", slipFile);

    startTransition(async () => {
      const result = await updateExpenseDirectAction(formData);
      if (result.error || !result.data) {
        toast.error(result.error ?? "แก้ไขค่าใช้จ่ายไม่สำเร็จ");
        return;
      }
      toast.success(`บันทึกการแก้ไข ${result.data.document_no} แล้ว`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        className="h-10 gap-2 bg-blue-800 text-white hover:bg-blue-900"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-4 w-4" />
        ✏️ แก้ไขค่าใช้จ่าย (Edit)
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>แก้ไขค่าใช้จ่าย</DialogTitle>
            <DialogDescription>
              ปรับหมวดหมู่ ภาษี และไฟล์แนบ แล้วบันทึกทับเอกสารเดิม
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-semibold text-slate-700">หมวดหมู่ค่าใช้จ่าย</span>
              <select
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3"
                value={categoryChoice}
                onChange={(event) => setCategoryChoice(event.target.value)}
              >
                <option value="">เลือกหมวดหมู่</option>
                {categoryOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={CUSTOM_CATEGORY}>{CUSTOM_CATEGORY}</option>
              </select>
            </label>
            {categoryChoice === CUSTOM_CATEGORY ? (
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-semibold text-slate-700">พิมพ์หมวดหมู่เอง</span>
                <input
                  className="h-10 w-full rounded-lg border border-slate-200 px-3"
                  value={customCategory}
                  onChange={(event) => setCustomCategory(event.target.value)}
                />
              </label>
            ) : null}

            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">วันที่บิล</span>
              <input
                type="date"
                className="h-10 w-full rounded-lg border border-slate-200 px-3"
                value={expenseDate}
                onChange={(event) => setExpenseDate(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">
                เลขที่ใบกำกับภาษี / เลขที่บิลผู้จำหน่าย
              </span>
              <input
                className="h-10 w-full rounded-lg border border-slate-200 px-3"
                value={taxInvoiceNo}
                onChange={(event) => setTaxInvoiceNo(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">ชื่อผู้ขาย / ผู้ให้บริการ</span>
              <input
                className="h-10 w-full rounded-lg border border-slate-200 px-3"
                value={vendorName}
                onChange={(event) => setVendorName(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">
                เลขประจำตัวผู้เสียภาษี 13 หลัก
              </span>
              <input
                inputMode="numeric"
                maxLength={17}
                className="h-10 w-full rounded-lg border border-slate-200 px-3"
                value={vendorTaxId}
                onChange={(event) => setVendorTaxId(event.target.value)}
              />
            </label>

            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-semibold text-slate-700">วิธีคิดภาษี</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["INCLUSIVE", "ราคารวม VAT 7% (Inc. VAT)"],
                    ["EXCLUSIVE", "ราคาแยก VAT 7% (Exc. VAT)"],
                    ["NO_VAT", "ไม่มี VAT (noVAT 0%)"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm",
                      taxMode === mode
                        ? "border-blue-700 bg-blue-800 text-white"
                        : "border-slate-200 bg-white text-slate-700",
                    )}
                    onClick={() => applyTaxMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            {taxMode === "INCLUSIVE" ? (
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-semibold text-slate-700">ยอดรวมที่รวม VAT</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3"
                  value={Number.isFinite(gross) ? gross : 0}
                  onChange={(event) => onInclusiveGrossChange(event.target.value)}
                />
              </label>
            ) : null}

            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">มูลค่าก่อนภาษี (Net Amount)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                readOnly={taxMode === "INCLUSIVE"}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 read-only:bg-slate-50"
                value={netAmount}
                onChange={(event) => onNetChange(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">ภาษีมูลค่าเพิ่ม 7% (VAT Amount)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                readOnly={taxMode !== "EXCLUSIVE"}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 read-only:bg-slate-50"
                value={vatAmount}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  const vat = Number.isFinite(next) && next >= 0 ? next : 0;
                  setVatAmount(vat);
                  setGross(roundMoney(netAmount + vat));
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">หัก ณ ที่จ่าย (WHT Amount)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="h-10 w-full rounded-lg border border-slate-200 px-3"
                value={whtAmount}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setWhtAmount(Number.isFinite(next) && next >= 0 ? next : 0);
                }}
              />
            </label>
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-slate-700">ยอดรวมสุทธิ (Grand Total = Net + VAT)</p>
              <p className="flex h-10 items-center rounded-lg bg-slate-50 px-3 text-base font-bold tabular-nums text-slate-900">
                {grandTotal.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>

            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">ช่องทางการชำระเงิน</span>
              <select
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
              >
                <option value="CASH">CASH</option>
                <option value="TRANSFER">TRANSFER</option>
                <option value="CREDIT">CREDIT</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-slate-700">สมุดบัญชีธนาคาร</span>
              <select
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 disabled:bg-slate-50"
                value={bankAccountId}
                disabled={paymentMethod === "CASH"}
                onChange={(event) => setBankAccountId(event.target.value)}
              >
                <option value="">เลือกบัญชี</option>
                {props.bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-semibold text-slate-700">หมายเหตุ / รายละเอียด</span>
              <textarea
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
              />
            </label>

            <div
              onDragEnter={(event) => {
                event.preventDefault();
                setDraggingReceipt(true);
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) return;
                setDraggingReceipt(false);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={() => setDraggingReceipt(false)}
            >
              <DropBox
                label="อัปโหลดเปลี่ยนไฟล์ใบเสร็จ"
                hint="ลากรูปหรือ PDF มาวาง"
                fileName={receiptFile?.name ?? ""}
                dragging={draggingReceipt}
                onFile={(file) => {
                  setDraggingReceipt(false);
                  setReceiptFile(file);
                }}
              />
            </div>
            <div
              onDragEnter={(event) => {
                event.preventDefault();
                setDraggingSlip(true);
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) return;
                setDraggingSlip(false);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={() => setDraggingSlip(false)}
            >
              <DropBox
                label="อัปโหลดสลิปโอนเงินเพิ่มเติม"
                hint="ลากรูปหรือ PDF มาวาง"
                fileName={slipFile?.name ?? ""}
                dragging={draggingSlip}
                onFile={(file) => {
                  setDraggingSlip(false);
                  setSlipFile(file);
                }}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              className="bg-blue-800 text-white hover:bg-blue-900"
              disabled={pending}
              onClick={onSave}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              💾 บันทึกการแก้ไข
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
