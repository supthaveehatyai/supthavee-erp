"use client";

import { cn } from "@/lib/utils";
import VendorCombobox, { type Vendor } from "@/app/products/vendor-combobox";
import { VENDOR_ID_REQUIRED_MESSAGE } from "@/app/products/zod-schemas";
import { Switch } from "@/components/ui/switch";

const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";

export type ProductMatrixVendorFieldProps = {
  vendors: Vendor[];
  value: string;
  onChange: (vendorId: string) => void;
  onVendorsChange: (vendors: Vendor[]) => void;
  disabled?: boolean;
  /** When true (Make), Vendor is optional / locked and not required */
  isManufactured?: boolean;
  /** Show inline error when vendor_id fails UUID / required check */
  error?: string | null;
  className?: string;
  /** Extra hint under the combobox */
  hint?: string;
};

/**
 * Vendor field for Product Matrix Generator / Edit Model Modal.
 * Required for Buy goods; optional/locked when `is_manufactured` (Make).
 */
export function ProductMatrixVendorField({
  vendors,
  value,
  onChange,
  onVendorsChange,
  disabled = false,
  isManufactured = false,
  error = null,
  className,
  hint = "บังคับเลือกผู้จำหน่าย — บันทึกลง product_models.vendor_id (UUID) สำหรับ Bulk Mapping / Goods Receipt",
}: ProductMatrixVendorFieldProps) {
  const locked = disabled || isManufactured;
  const hintText = isManufactured
    ? "สินค้าผลิตเอง — ไม่ต้องระบุผู้จำหน่าย (vendor_id = null)"
    : hint;

  return (
    <div className={cn("relative block", className)}>
      <span className={labelClass}>
        ผู้จำหน่าย (Vendor){" "}
        {isManufactured ? (
          <span className="font-medium text-slate-400">ไม่บังคับ</span>
        ) : (
          <span
            className="font-bold text-red-600"
            title={VENDOR_ID_REQUIRED_MESSAGE}
          >
            * บังคับ
          </span>
        )}
      </span>
      <VendorCombobox
        required={!isManufactured}
        disabled={locked}
        vendors={vendors}
        value={value}
        onChange={onChange}
        onVendorsChange={onVendorsChange}
        className={cn(
          error &&
            "[&_button]:border-red-400 [&_button]:ring-2 [&_button]:ring-red-100",
          isManufactured && "opacity-60",
        )}
      />
      {error ? (
        <p className="mt-1.5 text-[11px] font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-slate-400">{hintText}</p>
      )}
      {!isManufactured && !value && !error ? (
        <p className="mt-1 text-[10px] font-medium text-amber-600">
          ยังไม่ได้เลือก Vendor — ไม่สามารถบันทึกโครงร่างหรือสร้าง SKU ได้
        </p>
      ) : null}
    </div>
  );
}

export type ProductMatrixServiceToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Marks product_models.is_service — skip stock check / inventory OUT.
 */
export function ProductMatrixServiceToggle({
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: ProductMatrixServiceToggleProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border px-4 py-3",
        checked
          ? "border-violet-200 bg-violet-50/70"
          : "border-slate-200 bg-slate-50/80",
        className,
      )}
    >
      <div>
        <p className="text-sm font-semibold text-slate-800">
          เป็นงานบริการ (ไม่ตัดสต็อก)
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          เปิดเมื่อรุ่นนี้เป็นงานบริการ — ไม่เช็ค/ไม่ตัดสต็อก และซ่อน Vendor / Brand
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label="เป็นงานบริการ ไม่ตัดสต็อก"
      />
    </div>
  );
}

export type ProductMatrixRawMaterialToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Marks product_models.is_raw_material — excluded from Sales SKU Picker.
 */
export function ProductMatrixRawMaterialToggle({
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: ProductMatrixRawMaterialToggleProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border px-4 py-3",
        checked
          ? "border-amber-200 bg-amber-50/70"
          : "border-slate-200 bg-slate-50/80",
        className,
      )}
    >
      <div>
        <p className="text-sm font-semibold text-slate-800">
          เป็นวัตถุดิบ (Is Raw Material)
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          เปิดเมื่อรุ่นนี้เป็นวัตถุดิบ — ใช้รับเข้าคลังผ่าน AP/Goods Receipt
          แต่จะไม่แสดงใน Smart SKU Picker ของเอกสารขาย
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label="เป็นวัตถุดิบ Is Raw Material"
      />
    </div>
  );
}

export type ProductMatrixManufacturedToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Marks product_models.is_manufactured — Make (In-house) vs Buy.
 * When true, Vendor is not required; cost comes from BOM.
 */
export function ProductMatrixManufacturedToggle({
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: ProductMatrixManufacturedToggleProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border px-4 py-3",
        checked
          ? "border-emerald-200 bg-emerald-50/70"
          : "border-slate-200 bg-slate-50/80",
        className,
      )}
    >
      <div>
        <p className="text-sm font-semibold text-slate-800">
          ผลิตเอง (In-house Production)
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          เปิดเมื่อรุ่นนี้ผลิตเอง (Make) — ไม่บังคับผู้จำหน่าย
          และคำนวณต้นทุนผ่านสูตรการผลิต (BOM)
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label="ผลิตเอง In-house Production"
      />
    </div>
  );
}
