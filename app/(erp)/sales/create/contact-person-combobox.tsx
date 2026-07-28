"use client";

/**
 * Contact Person Smart Combobox — presentational only.
 * Options come from `getContactPersons(contactId)` (Server Action) via parent.
 */

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import type { ContactPersonOption } from "@/types/document";
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

export type ContactPersonComboboxProps = {
  options: ContactPersonOption[];
  value: string;
  onChange: (contactPersonId: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
};

function formatPersonLabel(person: ContactPersonOption): string {
  const role = person.department_or_role?.trim();
  const phone = person.phone?.trim();
  const extras = [role, phone].filter(Boolean).join(" · ");
  return extras ? `${person.name} (${extras})` : person.name;
}

export default function ContactPersonCombobox({
  options,
  value,
  onChange,
  disabled = false,
  isLoading = false,
  placeholder = "ค้นหาและเลือกผู้ติดต่อ...",
  emptyMessage = "ไม่พบผู้ติดต่อ",
}: ContactPersonComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = options.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return options;
    return options.filter((item) => {
      const haystack = [
        item.name,
        item.phone ?? "",
        item.email ?? "",
        item.department_or_role ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("th");
      return haystack.includes(keyword);
    });
  }, [options, search]);

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
              ? "กำลังโหลดผู้ติดต่อ..."
              : selected
                ? formatPersonLabel(selected)
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
            placeholder="พิมพ์ชื่อ / เบอร์ / แผนก..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {filtered.map((person) => {
                const isSelected = person.id === value;
                return (
                  <CommandItem
                    key={person.id}
                    value={person.id}
                    onSelect={() => {
                      onChange(person.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {person.name}
                        {person.is_primary ? (
                          <span className="ml-1.5 text-[10px] font-semibold text-blue-600">
                            หลัก
                          </span>
                        ) : null}
                      </p>
                      {(person.department_or_role || person.phone) && (
                        <p className="truncate text-[11px] text-slate-500">
                          {[person.department_or_role, person.phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <Check
                      className={cn(
                        "size-4 shrink-0 text-blue-600",
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
  );
}
