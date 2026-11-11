"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const PILLS: { id: string; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "QT", label: "ใบเสนอราคา (QT)" },
  { id: "SO", label: "ใบสั่งขาย (SO)" },
  { id: "INV_DO", label: "ใบส่งของ (INV_DO)" },
  { id: "TAX", label: "ใบกำกับภาษี (TAX_INV / CS_TAX)" },
  { id: "ABB", label: "อย่างย่อ (ABB)" },
];

export function SalesDocTypePills() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get("kind") ?? "all";

  function select(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (id === "all") next.delete("kind");
    else next.set("kind", id);
    next.delete("page");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {PILLS.map((pill) => {
        const selected = active === pill.id;
        return (
          <button
            key={pill.id}
            type="button"
            onClick={() => select(pill.id)}
            className={
              selected
                ? "rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white"
                : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            }
          >
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
