"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  nextContactSort,
  sortArrow,
  type ContactSortKey,
  type SortDir,
} from "@/lib/utils/billing-list-sort";

const CONTACT_PILLS: {
  key: ContactSortKey;
  label: string;
  asc: string;
  desc: string;
}[] = [
  { key: "amount", label: "💰 เรียงตามยอดค้างชำระ", asc: "น้อย → มาก", desc: "มาก → น้อย" },
  { key: "name", label: "🔤 เรียงตามชื่อคู่ค้า", asc: "ก → ฮ", desc: "ฮ → ก" },
  { key: "count", label: "📄 เรียงตามจำนวนบิล", asc: "น้อย → มาก", desc: "มาก → น้อย" },
];

export function ContactSortBar({
  query,
  onQueryChange,
  sortKey,
  sortDir,
  onSort,
  placeholder = "ค้นหาชื่อคู่ค้า...",
}: {
  query: string;
  onQueryChange: (value: string) => void;
  sortKey: ContactSortKey;
  sortDir: SortDir;
  onSort: (key: ContactSortKey, dir: SortDir) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 pl-9"
          aria-label={placeholder}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {CONTACT_PILLS.map((pill) => {
          const active = sortKey === pill.key;
          const hint = active
            ? sortDir === "asc"
              ? pill.asc
              : pill.desc
            : pill.key === "name"
              ? pill.asc
              : pill.desc;
          return (
            <button
              key={pill.key}
              type="button"
              onClick={() => {
                const next = nextContactSort(sortKey, sortDir, pill.key);
                onSort(next.key, next.dir);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {pill.label} ({hint}) {sortArrow(active, sortDir)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SortHeaderButton({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 normal-case tracking-normal text-slate-600 hover:text-slate-900",
        align === "right" && "w-full justify-end",
        active && "text-blue-700",
      )}
    >
      <span>{label}</span>
      <span aria-hidden className={active ? "text-blue-700" : "text-slate-400"}>
        {sortArrow(active, dir)}
      </span>
    </button>
  );
}
