"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { createVendor } from "@/lib/actions/master";
import { cn } from "@/lib/utils";
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

export type Vendor = {
  id: string;
  company_name: string;
};

type VendorComboboxProps = {
  vendors: Vendor[];
  value: string;
  onChange: (vendorId: string) => void;
  onVendorsChange: (vendors: Vendor[]) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

const fieldClass =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";

function matchesSearch(vendor: Vendor, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase("th");
  if (!keyword) return true;
  return vendor.company_name.toLocaleLowerCase("th").includes(keyword);
}

export default function VendorCombobox({
  vendors,
  value,
  onChange,
  onVendorsChange,
  disabled = false,
  required = false,
  className,
}: VendorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [createError, setCreateError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  const selected = vendors.find((item) => item.id === value);

  const filtered = useMemo(
    () => vendors.filter((item) => matchesSearch(item, search)),
    [vendors, search],
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
    setNewCompanyName(search.trim());
    setNewPhone("");
    setCreateError("");
    setOpen(false);
    setIsCreateOpen(true);
  }

  function closeCreateDialog() {
    if (isSaving) return;
    setIsCreateOpen(false);
    setCreateError("");
  }

  async function saveVendor() {
    if (isSaving) return;
    setCreateError("");

    const companyName = newCompanyName.trim();
    if (!companyName) {
      setCreateError("กรุณากรอกชื่อผู้จำหน่าย");
      return;
    }

    const duplicate = vendors.find(
      (item) =>
        item.company_name.trim().toLocaleLowerCase("th") ===
        companyName.toLocaleLowerCase("th"),
    );
    if (duplicate) {
      const message = `ผู้จำหน่าย "${companyName}" มีอยู่ในระบบแล้ว`;
      setCreateError(message);
      toast.error(message);
      return;
    }

    setIsSaving(true);

    const { data, error } = await createVendor({
      company_name: companyName,
      phone: newPhone.trim() || undefined,
    });

    if (error || !data) {
      const message = error ?? "ไม่สามารถบันทึกผู้จำหน่ายใหม่ได้";
      setCreateError(message);
      toast.error(message);
      setIsSaving(false);
      return;
    }

    const created = data;
    const nextVendors = [...vendors, created].sort((left, right) =>
      left.company_name.localeCompare(right.company_name, "th"),
    );

    onVendorsChange(nextVendors);
    onChange(created.id);
    setIsSaving(false);
    setIsCreateOpen(false);
    setSearch("");
    toast.success(`เพิ่มผู้จำหน่าย ${created.company_name} แล้ว`);
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
          aria-labelledby="vendor-dialog-title"
          className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3
                id="vendor-dialog-title"
                className="text-sm font-bold text-slate-900"
              >
                เพิ่มผู้จำหน่ายใหม่
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-400">
                บันทึกลง contacts (contact_type = Vendor)
              </p>
            </div>
            <button
              type="button"
              onClick={closeCreateDialog}
              disabled={isSaving}
              aria-label="ปิดหน้าต่างเพิ่มผู้จำหน่าย"
              className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            >
              ×
            </button>
          </div>

          <div className="space-y-4 p-5">
            <label className="block">
              <span className={labelClass}>
                ชื่อผู้จำหน่าย <span className="text-red-500">*</span>
              </span>
              <input
                autoFocus
                value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void saveVendor();
                  }
                }}
                placeholder="เช่น บริษัท ตัวอย่าง จำกัด"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>เบอร์โทร (ถ้ามี)</span>
              <input
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void saveVendor();
                  }
                }}
                placeholder="เช่น 074-xxx-xxx"
                className={fieldClass}
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
                onClick={() => void saveVendor()}
                disabled={isSaving}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
              >
                {isSaving ? "กำลังบันทึก..." : "บันทึกผู้จำหน่าย"}
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
                {selected ? selected.company_name : "ค้นหาหรือเลือกผู้จำหน่าย"}
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
                placeholder="พิมพ์ค้นหาชื่อผู้จำหน่าย..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                {filtered.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">
                    {search.trim()
                      ? `ไม่พบผู้จำหน่ายที่ตรงกับ “${search.trim()}”`
                      : "ยังไม่มีผู้จำหน่าย"}
                  </div>
                )}

                <CommandGroup>
                  {filtered.map((vendor) => (
                    <CommandItem
                      key={vendor.id}
                      value={vendor.company_name}
                      onSelect={() => {
                        onChange(vendor.id);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0 text-blue-600",
                          value === vendor.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{vendor.company_name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__add_new_vendor__ ${search}`}
                    onSelect={openCreateDialog}
                    className="font-semibold text-blue-700 data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-800"
                  >
                    <Plus className="size-4 shrink-0" />
                    ➕ เพิ่มผู้จำหน่ายใหม่
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
