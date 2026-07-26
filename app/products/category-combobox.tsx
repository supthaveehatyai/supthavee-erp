"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { createCategory } from "@/lib/actions/master";
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

export type Category = {
  id: string;
  category_code: string;
  category_name: string;
};

type CategoryComboboxProps = {
  categories: Category[];
  value: string;
  onChange: (categoryId: string) => void;
  onCategoriesChange: (categories: Category[]) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

const fieldClass =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";

const CATEGORY_CODE_PATTERN = /^[A-Z]{2}$/;

const CATEGORY_GROUP_MAP: Record<string, string> = {
  A: "เสื้อโปโล",
  B: "เสื้อยืด",
  C: "เสื้อเชิ้ต",
  D: "เสื้อแจ็คเก็ต",
  E: "เสื้ออื่นๆ",
  F: "กางเกง",
  G: "ชุดกีฬา",
  H: "อุปกรณ์กีฬา",
  I: "ชุดวอร์ม",
  J: "อุปกรณ์เสริม",
  K: "กระเป๋า",
  L: "ผ้าผืน",
  M: "ผ้ากันเปื้อน",
  N: "หมวก",
  O: "เสื้อกั๊ก",
  P: "ขนส่ง",
  Q: "งานสั่งตัด",
  R: "อื่นๆ",
  S: "บริการ",
  T: "เครื่องดนตรี",
  U: "ชุดปฏิบัติธรรม",
  V: "วัตถุดิบ",
};

function normalizeCategoryCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
}

function getGroupLetter(categoryCode: string): string {
  const code = categoryCode.trim().toUpperCase();
  return code.charAt(0) || "#";
}

function buildGroupHeading(letter: string): string {
  return `${letter}: ${CATEGORY_GROUP_MAP[letter] ?? "อื่นๆ"}`;
}

function groupCategories(categories: Category[]) {
  const groups = new Map<string, Category[]>();

  for (const category of categories) {
    const letter = getGroupLetter(category.category_code);
    const existing = groups.get(letter) ?? [];
    existing.push(category);
    groups.set(letter, existing);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([letter, items]) => ({
      letter,
      heading: buildGroupHeading(letter),
      items: [...items].sort((left, right) =>
        left.category_code
          .trim()
          .toUpperCase()
          .localeCompare(right.category_code.trim().toUpperCase(), "en"),
      ),
    }));
}

function matchesSearch(category: Category, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase("th");
  if (!keyword) return true;
  return (
    category.category_name.toLocaleLowerCase("th").includes(keyword) ||
    category.category_code.toLocaleLowerCase("th").includes(keyword)
  );
}

export default function CategoryCombobox({
  categories,
  value,
  onChange,
  onCategoriesChange,
  disabled = false,
  required = false,
  className,
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryCode, setNewCategoryCode] = useState("");
  const [createError, setCreateError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  const selected = categories.find((item) => item.id === value);

  const filteredCategories = useMemo(
    () => categories.filter((item) => matchesSearch(item, search)),
    [categories, search],
  );

  const grouped = useMemo(
    () => groupCategories(filteredCategories),
    [filteredCategories],
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
    setNewCategoryName(search.trim());
    setNewCategoryCode("");
    setCreateError("");
    setOpen(false);
    setIsCreateOpen(true);
  }

  function closeCreateDialog() {
    if (isSaving) return;
    setIsCreateOpen(false);
    setCreateError("");
  }

  async function saveCategory() {
    if (isSaving) return;
    setCreateError("");

    const categoryName = newCategoryName.trim();
    const categoryCode = normalizeCategoryCode(newCategoryCode);

    if (!categoryName) {
      setCreateError("กรุณากรอกชื่อหมวดหมู่");
      return;
    }
    if (!CATEGORY_CODE_PATTERN.test(categoryCode)) {
      setCreateError("รหัสหมวดหมู่ต้องเป็นตัวพิมพ์ใหญ่ภาษาอังกฤษ 2 ตัวอักษร");
      return;
    }

    const duplicateCode = categories.find(
      (item) => item.category_code.trim().toUpperCase() === categoryCode,
    );
    if (duplicateCode) {
      const message = `รหัสหมวดหมู่ "${categoryCode}" มีอยู่ในระบบแล้ว`;
      setCreateError(message);
      toast.error(message);
      return;
    }

    const duplicateName = categories.find(
      (item) =>
        item.category_name.trim().toLocaleLowerCase("th") ===
        categoryName.toLocaleLowerCase("th"),
    );
    if (duplicateName) {
      const message = `ชื่อหมวดหมู่ "${categoryName}" มีอยู่ในระบบแล้ว`;
      setCreateError(message);
      toast.error(message);
      return;
    }

    setIsSaving(true);

    const { data, error } = await createCategory({
      category_code: categoryCode,
      category_name: categoryName,
    });

    if (error || !data) {
      const message = error ?? "ไม่สามารถบันทึกหมวดหมู่ใหม่ได้";
      setCreateError(message);
      toast.error(message);
      setIsSaving(false);
      return;
    }

    const created = data;
    const nextCategories = [...categories, created].sort((left, right) =>
      left.category_code
        .trim()
        .toUpperCase()
        .localeCompare(right.category_code.trim().toUpperCase(), "en"),
    );

    onCategoriesChange(nextCategories);
    onChange(created.id);
    setIsSaving(false);
    setIsCreateOpen(false);
    setSearch("");
    toast.success(`เพิ่มหมวดหมู่ ${created.category_name} แล้ว`);
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
          aria-labelledby="category-dialog-title"
          className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3
                id="category-dialog-title"
                className="text-sm font-bold text-slate-900"
              >
                เพิ่มหมวดหมู่ใหม่
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-400">
                บันทึกลง Master Data (mst_categories) ทันที
              </p>
            </div>
            <button
              type="button"
              onClick={closeCreateDialog}
              disabled={isSaving}
              aria-label="ปิดหน้าต่างเพิ่มหมวดหมู่"
              className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            >
              ×
            </button>
          </div>

          <div className="space-y-4 p-5">
            <label className="block">
              <span className={labelClass}>
                ชื่อหมวดหมู่ <span className="text-red-500">*</span>
              </span>
              <input
                autoFocus
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void saveCategory();
                  }
                }}
                placeholder="เช่น เสื้อโปโลแขนสั้น"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>
                รหัสหมวดหมู่ (2 ตัวอักษร){" "}
                <span className="text-red-500">*</span>
              </span>
              <input
                value={newCategoryCode}
                onChange={(event) =>
                  setNewCategoryCode(normalizeCategoryCode(event.target.value))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void saveCategory();
                  }
                }}
                placeholder="เช่น AA, BB"
                maxLength={2}
                className={`${fieldClass} font-mono uppercase tracking-widest`}
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                บังคับตัวพิมพ์ใหญ่ภาษาอังกฤษ 2 ตัวอักษร (A–Z)
              </span>
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
                onClick={() => void saveCategory()}
                disabled={isSaving}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
              >
                {isSaving ? "กำลังบันทึก..." : "บันทึกหมวดหมู่"}
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
                  ? `${selected.category_name} (${selected.category_code})`
                  : "ค้นหาหรือเลือกหมวดหมู่"}
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
                placeholder="พิมพ์ค้นหาชื่อหรือรหัสหมวดหมู่..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                {filteredCategories.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">
                    {search.trim()
                      ? `ไม่พบหมวดหมู่ที่ตรงกับ “${search.trim()}”`
                      : "ยังไม่มีหมวดหมู่"}
                  </div>
                )}

                {grouped.map((group) => (
                  <CommandGroup key={group.letter} heading={group.heading}>
                    {group.items.map((category) => (
                      <CommandItem
                        key={category.id}
                        value={`${category.category_code} ${category.category_name}`}
                        onSelect={() => {
                          onChange(category.id);
                          setOpen(false);
                          setSearch("");
                        }}
                      >
                        <Check
                          className={cn(
                            "size-4 shrink-0 text-blue-600",
                            value === category.id
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">
                          {category.category_name}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">
                          {category.category_code}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}

                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__add_new__ ${search}`}
                    onSelect={openCreateDialog}
                    className="font-semibold text-blue-700 data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-800"
                  >
                    <Plus className="size-4 shrink-0" />
                    ➕ เพิ่มหมวดหมู่ใหม่
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
