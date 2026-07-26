"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Braces, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  formatOcrPatternConfig,
  OCR_PATTERN_CONFIG_EXAMPLE,
  parseOcrPatternConfigJson,
  type OcrPatternConfig,
} from "@/app/contacts/contacts";

export type VendorOcrConfigSectionProps = {
  /** Raw JSON string bound to the editor */
  value: string;
  onChange: (json: string) => void;
  disabled?: boolean;
  className?: string;
  /** Open the Advanced Settings accordion by default */
  defaultOpen?: boolean;
};

/**
 * Advanced Settings — OCR Configuration for Vendor contacts.
 * Binds a formatted JSON editor to `contacts.ocr_pattern_config`.
 */
export function VendorOcrConfigSection({
  value,
  onChange,
  disabled = false,
  className,
  defaultOpen = false,
}: VendorOcrConfigSectionProps) {
  const [localError, setLocalError] = useState("");

  const validation = useMemo(
    () => parseOcrPatternConfigJson(value),
    [value],
  );

  function handleChange(next: string) {
    onChange(next);
    if (localError) setLocalError("");
  }

  function handleFormat() {
    const result = parseOcrPatternConfigJson(value);
    if (!result.ok) {
      setLocalError(result.error);
      return;
    }
    onChange(formatOcrPatternConfig(result.value));
    setLocalError("");
  }

  function handleLoadExample() {
    onChange(formatOcrPatternConfig(OCR_PATTERN_CONFIG_EXAMPLE));
    setLocalError("");
  }

  function handleReset() {
    onChange(formatOcrPatternConfig({}));
    setLocalError("");
  }

  const showError = localError || (!validation.ok ? validation.error : "");
  const isValid = validation.ok;

  return (
    <div className={cn("border-t border-slate-200 pt-6", className)}>
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultOpen ? "ocr-config" : undefined}
      >
        <AccordionItem
          value="ocr-config"
          className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/40 px-4"
        >
          <AccordionTrigger className="py-3.5">
            <span className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-amber-50 text-amber-700">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-semibold text-slate-800">
                  Advanced Settings · OCR Configuration
                </span>
                <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                  กำหนด JSON สำหรับ AI Vision (ocr_pattern_config) —
                  ใช้ตอน Smart Goods Receipt
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label
                  htmlFor="ocr-pattern-config-editor"
                  className="text-xs font-semibold text-slate-700"
                >
                  ocr_pattern_config (JSON)
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={handleLoadExample}
                    className="h-8 text-[11px]"
                  >
                    โหลดตัวอย่าง
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={handleFormat}
                    className="h-8 text-[11px]"
                  >
                    <Braces className="size-3.5" aria-hidden />
                    Format JSON
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={handleReset}
                    className="h-8 text-[11px]"
                  >
                    ล้างเป็น {"{}"}
                  </Button>
                </div>
              </div>

              <textarea
                id="ocr-pattern-config-editor"
                spellCheck={false}
                disabled={disabled}
                value={value}
                onChange={(event) => handleChange(event.target.value)}
                onBlur={() => {
                  const result = parseOcrPatternConfigJson(value);
                  if (!result.ok) setLocalError(result.error);
                  else setLocalError("");
                }}
                rows={12}
                placeholder={`{\n  "prompt_hints": "...",\n  "invoice_no_hint": "เลขที่เอกสารอยู่มุมขวาบน...",\n  "invoice_date_hint": "วันที่เอกสารอยู่ถัดจากเลขที่เอกสาร เป็นปี พ.ศ....",\n  "field_map": { "sku": "raw_vendor_sku" }\n}`}
                aria-invalid={!isValid}
                className={cn(
                  "w-full resize-y rounded-xl border bg-slate-950 px-3 py-3 font-mono text-[12px] leading-relaxed text-emerald-300 shadow-inner outline-none transition placeholder:text-slate-600 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
                  isValid
                    ? "border-slate-700 focus:border-emerald-500 focus:ring-emerald-500/20"
                    : "border-red-500 focus:border-red-500 focus:ring-red-500/30",
                )}
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                {showError ? (
                  <p
                    role="alert"
                    className="text-[11px] font-medium text-red-600"
                  >
                    {showError}
                  </p>
                ) : (
                  <p className="text-[11px] text-emerald-700">
                    JSON ถูกต้อง — พร้อมบันทึกลง contacts.ocr_pattern_config
                  </p>
                )}
                <p className="text-[10px] text-slate-400">
                  ต้องเป็น object เท่านั้น (ไม่ใช่ array / string)
                </p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export type VendorFormProps = {
  /** When true, shows the OCR Advanced Settings block (Vendor only) */
  showOcrConfig: boolean;
  ocrPatternConfigJson: string;
  onOcrPatternConfigJsonChange: (json: string) => void;
  disabled?: boolean;
  children?: ReactNode;
};

/**
 * Vendor-specific form sections for create / edit.
 * Wrap shared contact fields as `children`; OCR config appears for Vendors only.
 */
export default function VendorForm({
  showOcrConfig,
  ocrPatternConfigJson,
  onOcrPatternConfigJsonChange,
  disabled = false,
  children,
}: VendorFormProps) {
  return (
    <div className="space-y-7">
      {children}
      {showOcrConfig ? (
        <VendorOcrConfigSection
          value={ocrPatternConfigJson}
          onChange={onOcrPatternConfigJsonChange}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

/** Re-export helper for parent submit handlers */
export function validateVendorOcrConfig(
  json: string,
):
  | { ok: true; value: OcrPatternConfig }
  | { ok: false; error: string } {
  return parseOcrPatternConfigJson(json);
}
