"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  createSize,
  updateSize,
  type MasterSize,
} from "@/lib/actions/master";
import { cn } from "@/lib/utils";
import {
  SIZE_CODE_ERROR_MESSAGE,
  SIZE_CODE_LENGTH,
  parseSizeCode,
  parseSizeForm,
} from "@/app/products/zod-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type SizeFormValues = {
  id?: string;
  brand_id?: string | null;
  size_label: string;
  size_code: string;
  sort_order: number;
};

type SizeFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, dialog edits the row via `updateSize`. */
  initialSize?: SizeFormValues | null;
  /** Optional brand scope; omit / null = Global Size (`brand_id IS NULL`). */
  brandId?: string | null;
  onSuccess?: (size: MasterSize) => void;
};

/**
 * Normalize size_code while typing: uppercase A–Z / 0–9 only, max 2 chars.
 * Zero-pad (`S` → `0S`) is applied on submit via Server Action / parseSizeForm path.
 */
export function normalizeSizeCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, SIZE_CODE_LENGTH);
}

/**
 * Master Data create/edit form for `mst_sizes`.
 * Validates with Zod before calling Server Actions.
 */
export default function SizeFormDialog({
  open,
  onOpenChange,
  initialSize = null,
  brandId = null,
  onSuccess,
}: SizeFormDialogProps) {
  const isEdit = Boolean(initialSize?.id);
  const [sizeLabel, setSizeLabel] = useState("");
  const [sizeCode, setSizeCode] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSizeLabel(initialSize?.size_label ?? "");
    setSizeCode(normalizeSizeCodeInput(initialSize?.size_code ?? ""));
    setSortOrder(
      initialSize?.sort_order != null ? String(initialSize.sort_order) : "",
    );
    setFormError("");
  }, [open, initialSize]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!isSaving) onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, isSaving, onOpenChange]);

  const sizeCodeError = useMemo(() => {
    if (!sizeCode) return "";
    if (sizeCode.length === 1) return ""; // will zero-pad on submit
    const parsed = parseSizeCode(sizeCode);
    return parsed.ok ? "" : parsed.error;
  }, [sizeCode]);

  const canSubmit =
    !isSaving &&
    sizeLabel.trim().length > 0 &&
    sortOrder.trim() !== "" &&
    !sizeCodeError &&
    (sizeCode.length === SIZE_CODE_LENGTH || sizeCode.length === 1);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    setFormError("");

    const sortOrderNumber = Number(sortOrder);
    const normalizedCode =
      sizeCode.length === 1
        ? sizeCode.padStart(SIZE_CODE_LENGTH, "0")
        : sizeCode;
    const parsed = parseSizeForm({
      id: initialSize?.id,
      brand_id: initialSize?.brand_id ?? brandId ?? null,
      size_label: sizeLabel,
      size_code: normalizedCode,
      sort_order: sortOrderNumber,
    });

    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }

    setIsSaving(true);
    try {
      const result = isEdit
        ? await updateSize({
            id: parsed.data.id ?? initialSize?.id ?? "",
            size_label: parsed.data.size_label,
            size_code: parsed.data.size_code,
            sort_order: parsed.data.sort_order,
          })
        : await createSize({
            brand_id: parsed.data.brand_id ?? null,
            size_label: parsed.data.size_label,
            size_code: parsed.data.size_code,
            sort_order: parsed.data.sort_order,
          });

      if (result.error || !result.data) {
        const message = result.error ?? "ไม่สามารถบันทึกไซส์ได้";
        setFormError(message);
        toast.error(message);
        return;
      }

      toast.success(
        isEdit
          ? `อัปเดตไซส์ ${result.data.size_label} แล้ว`
          : `สร้างไซส์ ${result.data.size_label} แล้ว`,
      );
      onSuccess?.(result.data);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onOpenChange(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="size-form-dialog-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3
              id="size-form-dialog-title"
              className="text-sm font-bold text-slate-900"
            >
              {isEdit ? "แก้ไขไซส์ (Master Data)" : "สร้างไซส์ใหม่ (Master Data)"}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              บันทึกลง `mst_sizes` — รหัสไซส์ล็อก {SIZE_CODE_LENGTH} ตัวอักษร
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            aria-label="ปิดหน้าต่าง"
            className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <Label htmlFor="master-size-label">
              ชื่อป้ายไซส์ (Size Label) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="master-size-label"
              autoFocus
              required
              value={sizeLabel}
              onChange={(event) => {
                setSizeLabel(event.target.value);
                setFormError("");
              }}
              placeholder="เช่น Extra Large"
              maxLength={20}
              disabled={isSaving}
            />
          </div>

          <div>
            <Label htmlFor="master-size-code">
              รหัสตัวย่อ (Size Code) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="master-size-code"
              required
              value={sizeCode}
              onChange={(event) => {
                setSizeCode(normalizeSizeCodeInput(event.target.value));
                setFormError("");
              }}
              placeholder="เช่น XL"
              maxLength={SIZE_CODE_LENGTH}
              disabled={isSaving}
              className={cn(
                "font-mono uppercase tracking-widest",
                sizeCodeError &&
                  "border-red-300 focus:border-red-400 focus:ring-red-100",
              )}
              aria-invalid={Boolean(sizeCodeError)}
            />
            {sizeCodeError ? (
              <p
                role="alert"
                className="mt-1.5 text-[11px] font-medium text-red-600"
              >
                {sizeCodeError}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400">
                {SIZE_CODE_ERROR_MESSAGE}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="master-size-sort">
              ลำดับ (Sort Order) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="master-size-sort"
              required
              type="number"
              min={0}
              step={10}
              value={sortOrder}
              onChange={(event) => {
                setSortOrder(event.target.value);
                setFormError("");
              }}
              placeholder="เช่น 40 (Gap of 10)"
              disabled={isSaving}
              className="tabular-nums"
            />
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
            >
              {formError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              ยกเลิก
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {isSaving ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกไซส์"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
