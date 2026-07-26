"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { createBrand } from "@/lib/actions/master";
import { cn } from "@/lib/utils";
import { normalizeSkuPart } from "./product-sku";
import {
  Command,
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

export type Brand = {
  id: string;
  brand_code: string;
  brand_name: string;
};

type BrandComboboxProps = {
  brands: Brand[];
  value: string;
  onChange: (brandId: string) => void;
  onBrandsChange: (brands: Brand[]) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

const fieldClass =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";

function normalizeBrandCode(value: string): string {
  return normalizeSkuPart(value).replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

function matchesSearch(brand: Brand, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase("th");
  if (!keyword) return true;
  return (
    brand.brand_name.toLocaleLowerCase("th").includes(keyword) ||
    brand.brand_code.toLocaleLowerCase("th").includes(keyword)
  );
}

export default function BrandCombobox({
  brands,
  value,
  onChange,
  onBrandsChange,
  disabled = false,
  required = false,
  className,
}: BrandComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandCode, setNewBrandCode] = useState("");
  const [createError, setCreateError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  const selected = brands.find((item) => item.id === value);

  const filtered = useMemo(
    () => brands.filter((item) => matchesSearch(item, search)),
    [brands, search],
  );

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

  function openCreateDialog() {
    setNewBrandName(search.trim());
    setNewBrandCode(normalizeBrandCode(search));
    setCreateError("");
    setOpen(false);
    setIsCreateOpen(true);
  }

  function closeCreateDialog() {
    if (isSaving) return;
    setIsCreateOpen(false);
    setCreateError("");
  }

  async function saveBrand() {
    if (isSaving) return;
    setCreateError("");

    const brandName = newBrandName.trim();
    const brandCode = normalizeBrandCode(newBrandCode);

    if (!brandName) {
      setCreateError("กรุณากรอกชื่อแบรนด์");
      return;
    }
    if (!brandCode) {
      setCreateError("กรุณากรอกรหัสแบรนด์เป็นภาษาอังกฤษหรือตัวเลข");
      return;
    }

    const duplicateCode = brands.find(
      (item) => item.brand_code.trim().toUpperCase() === brandCode,
    );
    if (duplicateCode) {
      const message = `รหัสแบรนด์ "${brandCode}" มีอยู่ในระบบแล้ว`;
      setCreateError(message);
      toast.error(message);
      return;
    }

    const duplicateName = brands.find(
      (item) =>
        item.brand_name.trim().toLocaleLowerCase("th") ===
        brandName.toLocaleLowerCase("th"),
    );
    if (duplicateName) {
      const message = `ชื่อแบรนด์ "${brandName}" มีอยู่ในระบบแล้ว`;
      setCreateError(message);
      toast.error(message);
      return;
    }

    setIsSaving(true);

    const { data, error } = await createBrand({
      brand_code: brandCode,
      brand_name: brandName,
    });

    if (error || !data) {
      const message = error ?? "ไม่สามารถบันทึกแบรนด์ใหม่ได้";
      setCreateError(message);
      toast.error(message);
      setIsSaving(false);
      return;
    }

    const created = data;
    const nextBrands = [...brands, created].sort((left, right) =>
      left.brand_name.localeCompare(right.brand_name, "th"),
    );

    // Update list + auto-select without remounting the Matrix dialog
    onBrandsChange(nextBrands);
    onChange(created.id);
    setIsSaving(false);
    setIsCreateOpen(false);
    setSearch("");
    toast.success(`เพิ่มแบรนด์ ${created.brand_name} แล้ว`);
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
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="brand-dialog-title"
          className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3
                id="brand-dialog-title"
                className="text-sm font-bold text-slate-900"
              >
                เพิ่มแบรนด์ใหม่
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-400">
                บันทึกลง Master Data (mst_brands) ทันที
              </p>
            </div>
            <button
              type="button"
              onClick={closeCreateDialog}
              disabled={isSaving}
              aria-label="ปิดหน้าต่างเพิ่มแบรนด์"
              className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            >
              ×
            </button>
          </div>

          <div className="space-y-4 p-5">
            <label className="block">
              <span className={labelClass}>
                ชื่อแบรนด์ <span className="text-red-500">*</span>
              </span>
              <input
                autoFocus
                value={newBrandName}
                onChange={(event) => setNewBrandName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void saveBrand();
                  }
                }}
                placeholder="เช่น Portman"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>
                รหัสแบรนด์ (ใช้ต่อใน SKU){" "}
                <span className="text-red-500">*</span>
              </span>
              <input
                value={newBrandCode}
                onChange={(event) =>
                  setNewBrandCode(normalizeBrandCode(event.target.value))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void saveBrand();
                  }
                }}
                placeholder="เช่น PTM"
                maxLength={10}
                className={`${fieldClass} font-mono uppercase`}
              />
            </label>

            {createError && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              >
                {createError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={isSaving}
                className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => void saveBrand()}
                disabled={isSaving}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
              >
                {isSaving ? "กำลังบันทึก..." : "บันทึกแบรนด์"}
              </button>
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
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-required={required}
              disabled={disabled}
              className={cn(
                fieldClass,
                "flex items-center justify-between gap-2 text-left font-normal",
              )}
            >
              <span
                className={cn(
                  "truncate",
                  selected ? "text-slate-800" : "text-slate-400",
                )}
              >
                {selected
                  ? `${selected.brand_name} (${selected.brand_code})`
                  : "ค้นหาหรือเลือกแบรนด์"}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="z-[9999] p-0"
            align="start"
            sideOffset={6}
            collisionPadding={12}
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="พิมพ์ค้นหาชื่อหรือรหัสแบรนด์..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                {filtered.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">
                    {search.trim()
                      ? `ไม่พบแบรนด์ที่ตรงกับ “${search.trim()}”`
                      : "ยังไม่มีแบรนด์"}
                  </div>
                )}

                <CommandGroup>
                  {filtered.map((brand) => (
                    <CommandItem
                      key={brand.id}
                      value={`${brand.brand_code} ${brand.brand_name}`}
                      onSelect={() => {
                        onChange(brand.id);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0 text-blue-600",
                          value === brand.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex-1 truncate">{brand.brand_name}</span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {brand.brand_code}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__add_new_brand__ ${search}`}
                    onSelect={openCreateDialog}
                    className="font-semibold text-blue-700 data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-800"
                  >
                    <Plus className="size-4 shrink-0" />
                    ➕ เพิ่มแบรนด์ใหม่
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <input
          tabIndex={-1}
          aria-hidden="true"
          required={required}
          value={value}
          onChange={() => undefined}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      </div>

      {createDialog}
    </>
  );
}
