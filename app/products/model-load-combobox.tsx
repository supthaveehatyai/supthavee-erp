"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoadableProductModel } from "@/types/product-matrix";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type ModelLoadComboboxProps = {
  models: LoadableProductModel[];
  value: string;
  onChange: (modelId: string, model: LoadableProductModel | null) => void;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
};

function statusBadgeClass(status: string | null | undefined): string {
  if (status === "ACTIVE") {
    return "bg-emerald-100 text-emerald-800";
  }
  return "bg-amber-100 text-amber-800";
}

function matchesSearch(model: LoadableProductModel, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase("th");
  if (!keyword) return true;
  return [
    model.model_code,
    model.name,
    model.short_name,
    model.brand_name,
    model.brand_code,
    model.category_name,
    model.category_code,
    model.status,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase("th").includes(keyword));
}

export default function ModelLoadCombobox({
  models,
  value,
  onChange,
  disabled = false,
  isLoading = false,
  className,
}: ModelLoadComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = models.find((item) => item.id === value);

  const filtered = useMemo(
    () => models.filter((item) => matchesSearch(item, search)),
    [models, search],
  );

  return (
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
          disabled={disabled || isLoading}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-left text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {isLoading
              ? "กำลังโหลดโมเดล..."
              : selected
                ? `${selected.model_code} — ${selected.name}`
                : "ค้นหาโครงร่าง / รุ่นสินค้า..."}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-2">
            {selected?.status && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  statusBadgeClass(selected.status),
                )}
              >
                {selected.status}
              </span>
            )}
            <ChevronsUpDown className="size-4 text-slate-400" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหา model_code, ชื่อ, แบรนด์..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandGroup>
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-400">
                  ไม่พบโมเดล DRAFT / ACTIVE
                </div>
              ) : (
                filtered.map((model) => {
                  const isSelected = model.id === value;
                  return (
                    <CommandItem
                      key={model.id}
                      value={model.id}
                      onSelect={() => {
                        onChange(model.id, model);
                        setOpen(false);
                        setSearch("");
                      }}
                      className="flex items-start gap-2"
                    >
                      <Check
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-800">
                            {model.model_code}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase",
                              statusBadgeClass(model.status),
                            )}
                          >
                            {model.status ?? "DRAFT"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-slate-600">
                          {model.name}
                        </p>
                        <p className="truncate text-[10px] text-slate-400">
                          {[model.brand_name, model.category_name]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </CommandItem>
                  );
                })
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
