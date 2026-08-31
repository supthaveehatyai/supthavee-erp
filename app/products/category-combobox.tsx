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
  parent_id?: string | null;
  parent_category_code?: string | null;
  parent_category_name?: string | null;
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

type CategoryGroup = {
  parentId: string;
  heading: string;
  items: Category[];
};

const fieldClass =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";

const CATEGORY_CODE_PATTERN = /^[A-Z]{2}$/;

function normalizeCategoryCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
}

function formatGroupHeading(
  name: string,
  code: string | null | undefined,
): string {
  const trimmedCode = code?.trim();
  return trimmedCode ? `${name} (${trimmedCode})` : name;
}

function isRootCategory(category: Category): boolean {
  return !category.parent_id;
}

function isSelectableCategory(category: Category): boolean {
  return Boolean(category.parent_id);
}

function groupCategoriesByHierarchy(
  categories: Category[],
  selectableItems: Category[],
): CategoryGroup[] {
  const roots = categories
    .filter(isRootCategory)
    .sort((left, right) =>
      left.category_code
        .trim()
        .toUpperCase()
        .localeCompare(right.category_code.trim().toUpperCase(), "en"),
    );

  const selectableById = new Map(
    selectableItems.map((item) => [item.id, item]),
  );
  const groups: CategoryGroup[] = [];
  const groupedChildIds = new Set<string>();

  for (const root of roots) {
    const items = categories
      .filter(
        (item) =>
          item.parent_id === root.id && selectableById.has(item.id),
      )
      .sort((left, right) =>
        left.category_code
          .trim()
          .toUpperCase()
          .localeCompare(right.category_code.trim().toUpperCase(), "en"),
      );

    for (const item of items) {
      groupedChildIds.add(item.id);
    }

    if (items.length > 0) {
      groups.push({
        parentId: root.id,
        heading: formatGroupHeading(root.category_name, root.category_code),
        items,
      });
    }
  }

  const orphans = selectableItems.filter((item) => !groupedChildIds.has(item.id));
  if (orphans.length > 0) {
    const orphanGroups = new Map<string, CategoryGroup>();

    for (const child of orphans) {
      const parentId = child.parent_id ?? "__orphan__";
      const heading = child.parent_category_name
        ? formatGroupHeading(
            child.parent_category_name,
            child.parent_category_code,
          )
        : "อื่นๆ";

      const existing = orphanGroups.get(parentId);
      if (existing) {
        existing.items.push(child);
      } else {
        orphanGroups.set(parentId, {
          parentId,
          heading,
          items: [child],
        });
      }
    }

    for (const group of orphanGroups.values()) {
      group.items.sort((left, right) =>
        left.category_code
          .trim()
          .toUpperCase()
          .localeCompare(right.category_code.trim().toUpperCase(), "en"),
      );
      groups.push(group);
    }
  }

  return groups;
}

function matchesSearch(category: Category, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase("th");
  if (!keyword) return true;
  return (
    category.category_name.toLocaleLowerCase("th").includes(keyword) ||
    category.category_code.toLocaleLowerCase("th").includes(keyword) ||
    (category.parent_category_name ?? "")
      .toLocaleLowerCase("th")
      .includes(keyword) ||
    (category.parent_category_code ?? "")
      .toLocaleLowerCase("th")
      .includes(keyword)
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
  const [newParentId, setNewParentId] = useState("");
  const [createError, setCreateError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  const rootCategories = useMemo(
    () => categories.filter(isRootCategory),
    [categories],
  );

  const selectableCategories = useMemo(
    () => categories.filter(isSelectableCategory),
    [categories],
  );

  const selected = selectableCategories.find((item) => item.id === value);

  const filteredSelectable = useMemo(
    () => selectableCategories.filter((item) => matchesSearch(item, search)),
    [selectableCategories, search],
  );

  const grouped = useMemo(
    () => groupCategoriesByHierarchy(categories, filteredSelectable),
    [categories, filteredSelectable],
  );

  const selectableCount = filteredSelectable.length;

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
    setNewParentId("");
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
      parent_id: newParentId.trim() || null,
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
    if (created.parent_id) {
      onChange(created.id);
    }
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
                placeholder="เช่น ผ้าโพลีเอสเตอร์"
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
                placeholder="เช่น VC, VB"
                maxLength={2}
                className={`${fieldClass} font-mono uppercase tracking-widest`}
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                บังคับตัวพิมพ์ใหญ่ภาษาอังกฤษ 2 ตัวอักษร (A–Z)
              </span>
            </label>

            <label className="block">
              <span className={labelClass}>หมวดหมู่หลัก (Parent Category)</span>
              <select
                value={newParentId}
                onChange={(event) => setNewParentId(event.target.value)}
                disabled={isSaving}
                className={fieldClass}
              >
                <option value="">— ไม่ระบุ (หมวดหมู่ระดับราก / Group Header) —</option>
                {rootCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {formatGroupHeading(
                      category.category_name,
                      category.category_code,
                    )}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-400">
                เลือกหมวดหมู่หลักเพื่อสร้างหมวดย่อยที่เลือกได้ใน Matrix
                (เช่น &quot;ผ้าโพลีเอสเตอร์&quot; ภายใต้ &quot;วัตถุดิบ (RM)&quot;)
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
                {selectableCount === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">
                    {search.trim()
                      ? `ไม่พบหมวดหมู่ย่อยที่ตรงกับ “${search.trim()}”`
                      : selectableCategories.length === 0
                        ? "ยังไม่มีหมวดหมู่ย่อย — สร้างหมวดหมู่ภายใต้หมวดหมู่หลักก่อน"
                        : "ยังไม่มีหมวดหมู่ย่อย"}
                  </div>
                )}

                {grouped.map((group) => (
                  <CommandGroup key={group.parentId} heading={group.heading}>
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
