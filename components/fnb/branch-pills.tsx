"use client";

import { useEffect, useRef } from "react";
import type { FnbBranchOption } from "@/types/fnb";

export function fnbBranchStorageKey(brand: string, actor: string) {
  return `fnb-branch:${brand}:${actor || "staff"}`;
}

export function BranchPills({
  branches,
  active,
  onPick,
}: {
  branches: Pick<FnbBranchOption, "branch_code" | "branch_name_th">[];
  active: string;
  onPick: (code: string) => void;
}) {
  if (branches.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {branches.map((item) => {
        const selected = item.branch_code === active;
        return (
          <button
            key={item.branch_code}
            type="button"
            className={`min-h-11 rounded-full px-4 py-2 text-left text-sm font-semibold ${selected ? "bg-[var(--fnb-brand)] text-white" : "bg-white text-slate-900 ring-1 ring-slate-300"}`}
            onClick={() => onPick(item.branch_code)}
          >
            📍 {item.branch_code} {item.branch_name_th}
          </button>
        );
      })}
    </div>
  );
}

export function useStoredBranch(
  storageKey: string,
  branches: { branch_code: string }[],
  onPick: (code: string) => void,
) {
  const once = useRef(false);
  useEffect(() => {
    if (!storageKey || once.current || branches.length === 0) return;
    once.current = true;
    if (new URLSearchParams(window.location.search).get("branch")) return;
    const saved = localStorage.getItem(storageKey);
    if (saved && branches.some((item) => item.branch_code === saved)) onPick(saved);
  }, [branches, onPick, storageKey]);
}
