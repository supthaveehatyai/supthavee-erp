"use client";

/**
 * Customer Smart Combobox — presentational only.
 * Options come from `listActiveCustomers()` (Server Action) via the parent.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateCustomerNickname } from "@/lib/actions/document-actions";
import type { CustomerOption } from "@/types/document";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
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

export function formatCustomerOptionLabel(customer: {
  company_name: string;
  nickname?: string | null;
}): string {
  const nickname = customer.nickname?.trim();
  if (!nickname) return customer.company_name;
  return `${nickname} — ${customer.company_name}`;
}

export type CustomerComboboxProps = {
  options: CustomerOption[];
  value: string;
  onChange: (contactId: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  /** After a quick nickname save so the parent option list stays in sync. */
  onNicknameChange?: (contactId: string, nickname: string | null) => void;
};

export default function CustomerCombobox({
  options,
  value,
  onChange,
  disabled = false,
  isLoading = false,
  placeholder = "ค้นหาและเลือกลูกค้า...",
  emptyMessage = "ไม่พบลูกค้า",
  onNicknameChange,
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [isSavingNickname, setIsSavingNickname] = useState(false);

  const selected = options.find((item) => item.id === value);

  useEffect(() => {
    setNicknameDraft(selected?.nickname?.trim() ?? "");
  }, [selected?.id, selected?.nickname]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return options;
    return options.filter((item) => {
      const nickname = item.nickname?.toLocaleLowerCase("th") ?? "";
      const company = item.company_name.toLocaleLowerCase("th");
      return company.includes(keyword) || nickname.includes(keyword);
    });
  }, [options, search]);

  async function saveNickname() {
    if (!selected || isSavingNickname || disabled) return;
    setIsSavingNickname(true);
    try {
      const result = await updateCustomerNickname(selected.id, nicknameDraft);
      if (result.error || !result.data) {
        toast.error(result.error ?? "บันทึกชื่อเล่นไม่สำเร็จ");
        return;
      }
      onNicknameChange?.(result.data.id, result.data.nickname);
      toast.success(
        result.data.nickname
          ? `บันทึกชื่อเล่น ${result.data.nickname} แล้ว`
          : "ล้างชื่อเล่นแล้ว",
      );
    } finally {
      setIsSavingNickname(false);
    }
  }

  return (
    <div className="min-w-0">
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
          disabled={disabled || isLoading}
          className="h-10 w-full justify-between font-normal"
        >
          <span
            className={cn(
              "truncate",
              selected ? "text-slate-800" : "text-slate-400",
            )}
          >
            {isLoading
              ? "กำลังโหลดลูกค้า..."
              : selected
                ? formatCustomerOptionLabel(selected)
                : placeholder}
          </span>
          {isLoading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="พิมพ์ชื่อเล่นหรือชื่อลูกค้า..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {filtered.map((customer) => {
                const isSelected = customer.id === value;
                return (
                  <CommandItem
                    key={customer.id}
                    value={customer.id}
                    onSelect={() => {
                      onChange(customer.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span className="flex-1 truncate">
                      {formatCustomerOptionLabel(customer)}
                    </span>
                    <Check
                      className={cn(
                        "size-4 text-blue-600",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {selected ? (
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={nicknameDraft}
          disabled={disabled || isSavingNickname}
          placeholder="ชื่อเล่น เช่น พี่ก๊ก"
          aria-label="ชื่อเล่นลูกค้า"
          onChange={(event) => setNicknameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveNickname();
            }
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60"
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || isSavingNickname}
          onClick={() => {
            void saveNickname();
          }}
          className="h-8 shrink-0 px-2 text-xs"
        >
          {isSavingNickname ? "กำลังบันทึก..." : "บันทึกชื่อเล่น"}
        </Button>
      </div>
    ) : null}
  </div>
  );
}
