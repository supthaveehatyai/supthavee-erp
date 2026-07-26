"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { createColor } from "@/lib/actions/master";
import { cn } from "@/lib/utils";
import {
  COLOR_CODE_ERROR_MESSAGE,
  COLOR_CODE_LENGTH,
  COLOR_CODE_REGEX,
  parseColorCode,
} from "@/app/products/zod-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type SmartColor = {
  id: string;
  color_code: string;
  color_name: string;
};

export { COLOR_CODE_LENGTH, COLOR_CODE_ERROR_MESSAGE, COLOR_CODE_REGEX };

/**
 * Normalize color_code: uppercase English letters only, max 3 chars.
 */
export function normalizeColorCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, COLOR_CODE_LENGTH);
}

/**
 * Strict rule: exactly 3 uppercase A–Z letters (/^[A-Z]{3}$/).
 */
export function isValidColorCode(value: string): boolean {
  return COLOR_CODE_REGEX.test(value);
}

/** Thai display name only — no Latin letters. */
export function isValidThaiColorName(value: string): boolean {
  const name = value.trim();
  if (!name) return false;
  if (/[A-Za-z]/.test(name)) return false;
  return /[\u0E00-\u0E7F]/.test(name);
}

export function formatColorOption(
  color: Pick<SmartColor, "color_name" | "color_code">,
): string {
  return `${color.color_name} (${color.color_code})`;
}

type SmartColorComboboxProps = {
  colors: SmartColor[];
  value: string[];
  onChange: (colorIds: string[]) => void;
  onColorsChange: (colors: SmartColor[]) => void;
  disabled?: boolean;
  className?: string;
};

export default function SmartColorCombobox({
  colors,
  value,
  onChange,
  onColorsChange,
  disabled = false,
  className,
}: SmartColorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newColorName, setNewColorName] = useState("");
  const [newColorCode, setNewColorCode] = useState("");
  const [createError, setCreateError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isCreateOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!isSaving) {
        setIsCreateOpen(false);
        setCreateError("");
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isCreateOpen, isSaving]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return colors;
    return colors.filter((color) => {
      const haystack = `${color.color_name} ${color.color_code}`.toLocaleLowerCase(
        "th",
      );
      return haystack.includes(keyword);
    });
  }, [colors, search]);

  const colorCodeError = useMemo(() => {
    if (!newColorCode) return "";
    if (!isValidColorCode(newColorCode)) return COLOR_CODE_ERROR_MESSAGE;
    return "";
  }, [newColorCode]);

  const canSaveNewColor =
    isValidThaiColorName(newColorName) &&
    isValidColorCode(newColorCode) &&
    !colorCodeError &&
    !isSaving;

  function toggleColor(colorId: string) {
    if (value.includes(colorId)) {
      onChange(value.filter((id) => id !== colorId));
      return;
    }
    onChange([...value, colorId]);
  }

  function openCreateDialog() {
    setNewColorName(search.trim());
    setNewColorCode("");
    setCreateError("");
    setOpen(false);
    setIsCreateOpen(true);
  }

  function closeCreateDialog() {
    if (isSaving) return;
    setIsCreateOpen(false);
    setCreateError("");
  }

  async function saveNewColor() {
    if (isSaving) return;
    setCreateError("");

    const colorName = newColorName.trim();
    const colorCode = normalizeColorCode(newColorCode);

    if (!colorName || !colorCode) {
      setCreateError("กรุณากรอกชื่อสีและรหัสสีให้ครบถ้วน");
      return;
    }
    if (!isValidThaiColorName(colorName)) {
      const message =
        "ชื่อสีต้องเป็นภาษาไทยเท่านั้น (ห้ามใช้ตัวอักษรภาษาอังกฤษ)";
      setCreateError(message);
      toast.error(message);
      return;
    }
    const codeCheck = parseColorCode(colorCode);
    if (!codeCheck.ok) {
      setCreateError(codeCheck.error);
      toast.error(codeCheck.error);
      return;
    }

    const duplicateCode = colors.find(
      (item) => item.color_code.trim().toUpperCase() === colorCode,
    );
    if (duplicateCode) {
      const message = `รหัสสี "${colorCode}" มีอยู่ในระบบแล้ว (${duplicateCode.color_name})`;
      setCreateError(message);
      toast.error(message);
      return;
    }

    const duplicateName = colors.find(
      (item) =>
        item.color_name.trim().toLocaleLowerCase("th") ===
        colorName.toLocaleLowerCase("th"),
    );
    if (duplicateName) {
      const message = `ชื่อสี "${colorName}" มีอยู่ในระบบแล้ว (${duplicateName.color_code})`;
      setCreateError(message);
      toast.error(message);
      return;
    }

    setIsSaving(true);

    const { data, error } = await createColor({
      color_code: colorCode,
      color_name: colorName,
    });

    if (error || !data) {
      const message = error ?? "ไม่สามารถบันทึกสีใหม่ได้";
      setCreateError(message);
      toast.error(message);
      setIsSaving(false);
      return;
    }

    const created = data;
    const nextColors = [...colors, created].sort((left, right) =>
      left.color_name.localeCompare(right.color_name, "th"),
    );

    onColorsChange(nextColors);
    onChange([...value, created.id]);
    setIsSaving(false);
    setIsCreateOpen(false);
    setSearch("");
    toast.success(`เพิ่มสี ${formatColorOption(created)} แล้ว`);
  }

  const createDialog =
    mounted &&
    isCreateOpen &&
    createPortal(
      <div
        role="presentation"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
        onMouseDown={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) closeCreateDialog();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="smart-color-dialog-title"
          className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3
                id="smart-color-dialog-title"
                className="text-sm font-bold text-slate-900"
              >
                เพิ่มสีใหม่
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-400">
                บันทึกลง Master Data (mst_colors) ทันที
              </p>
            </div>
            <button
              type="button"
              onClick={closeCreateDialog}
              disabled={isSaving}
              aria-label="ปิดหน้าต่างเพิ่มสี"
              className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            >
              ×
            </button>
          </div>

          <div className="space-y-4 p-5">
            <div>
              <Label htmlFor="smart-color-name">
                ชื่อสี (ภาษาไทย) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="smart-color-name"
                autoFocus
                value={newColorName}
                onChange={(event) => {
                  setNewColorName(event.target.value);
                  setCreateError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (canSaveNewColor) void saveNewColor();
                  }
                }}
                placeholder="เช่น ดำ, กรมท่า, เทาเข้ม"
                disabled={isSaving}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                กรอกชื่อเรียกภาษาไทยเท่านั้น ห้ามใช้ตัวอักษรภาษาอังกฤษ
              </p>
            </div>

            <div>
              <Label htmlFor="smart-color-code">
                รหัสสี (ใช้ต่อใน SKU) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="smart-color-code"
                value={newColorCode}
                onChange={(event) => {
                  setNewColorCode(normalizeColorCode(event.target.value));
                  setCreateError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (canSaveNewColor) void saveNewColor();
                  }
                }}
                placeholder="เช่น BLK, RED, NVY"
                maxLength={COLOR_CODE_LENGTH}
                disabled={isSaving}
                className={cn(
                  "font-mono uppercase tracking-widest",
                  colorCodeError && "border-red-300 focus:border-red-400 focus:ring-red-100",
                )}
                aria-invalid={Boolean(colorCodeError)}
              />
              {colorCodeError ? (
                <p role="alert" className="mt-1.5 text-[11px] font-medium text-red-600">
                  {colorCodeError}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">
                  ต้องเป็นตัวอักษรภาษาอังกฤษพิมพ์ใหญ่พอดี {COLOR_CODE_LENGTH} ตัว
                </p>
              )}
            </div>

            {(createError ||
              (newColorName.trim() && !isValidThaiColorName(newColorName))) && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              >
                {createError ||
                  "ชื่อสีต้องเป็นภาษาไทยเท่านั้น (ห้ามใช้ตัวอักษรภาษาอังกฤษ)"}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeCreateDialog}
                disabled={isSaving}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveNewColor()}
                disabled={!canSaveNewColor}
              >
                {isSaving ? "กำลังบันทึก..." : "บันทึกสี"}
              </Button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div className={cn("relative block", className)}>
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (disabled) return;
            setOpen(next);
            if (!next) setSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="h-10 w-full justify-between font-normal"
            >
              <span
                className={cn(
                  "truncate",
                  value.length > 0 ? "text-slate-800" : "text-slate-400",
                )}
              >
                {value.length > 0
                  ? `เลือกแล้ว ${value.length} สี`
                  : "ค้นหาหรือเลือกสีสินค้า..."}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="พิมพ์ค้นหาชื่อสีหรือรหัส..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                <CommandEmpty>ไม่พบสีที่ตรงกับคำค้น</CommandEmpty>
                <CommandGroup>
                  {filtered.map((color) => {
                    const checked = value.includes(color.id);
                    return (
                      <CommandItem
                        key={color.id}
                        value={color.id}
                        onSelect={() => toggleColor(color.id)}
                      >
                        <span
                          className={cn(
                            "grid size-4 place-items-center rounded border",
                            checked
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-300 bg-white",
                          )}
                        >
                          {checked && <Check className="size-3" />}
                        </span>
                        <span className="flex-1 truncate">
                          {formatColorOption(color)}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__create_color__"
                    onSelect={openCreateDialog}
                    className="text-blue-700"
                  >
                    <Plus className="size-4" />
                    เพิ่มสีใหม่
                    {search.trim() ? ` “${search.trim()}”` : ""}
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {value.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {colors
              .filter((color) => value.includes(color.id))
              .map((color) => (
                <span
                  key={color.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"
                >
                  {formatColorOption(color)}
                  <button
                    type="button"
                    aria-label={`ลบสี ${color.color_name}`}
                    disabled={disabled}
                    onClick={() => toggleColor(color.id)}
                    className="text-blue-400 transition hover:text-blue-700 disabled:opacity-50"
                  >
                    ×
                  </button>
                </span>
              ))}
          </div>
        )}
      </div>
      {createDialog}
    </>
  );
}
