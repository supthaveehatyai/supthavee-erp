"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { FnbBranchRow } from "@/types/holding";

const CT_BNP_OPENING = "2026-12-26";

function daysUntil(iso: string): number {
  const target = new Date(`${iso.slice(0, 10)}T00:00:00+07:00`);
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

export function FnbHub({
  branches,
  schemaMessage,
  initialTab,
}: {
  branches: FnbBranchRow[];
  schemaMessage: string | null;
  initialTab: string;
}) {
  const [brand, setBrand] = useState(initialTab === "branches" ? "all" : "all");
  const [branchCode, setBranchCode] = useState("all");
  const visible = useMemo(() => {
    return branches.filter((branch) => {
      if (branchCode !== "all") return branch.branch_code === branchCode;
      if (brand === "lucky") return /lucky/i.test(`${branch.brand_code} ${branch.brand_name ?? ""}`);
      if (brand === "chatr") return /ชา|chatr|ct-/i.test(`${branch.brand_code} ${branch.brand_name ?? ""} ${branch.branch_code}`);
      return true;
    });
  }, [branches, brand, branchCode]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-red-700">FB</p>
        <h1 className="text-2xl font-bold text-slate-900">ร้านเครื่องดื่ม</h1>
        <p className="text-sm text-slate-500">Lucky Cup และชาทรตะโหมด รวม {branches.length} สาขา</p>
      </div>
      {schemaMessage ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{schemaMessage}</div> : null}
      <div className="flex flex-wrap gap-2">
        <FilterButton active={brand === "all" && branchCode === "all"} onClick={() => { setBrand("all"); setBranchCode("all"); }}>
          ทุกแบรนด์รวม ({branches.length} สาขา)
        </FilterButton>
        <FilterButton active={brand === "lucky"} onClick={() => { setBrand("lucky"); setBranchCode("all"); }}>Lucky Cup</FilterButton>
        <FilterButton active={brand === "chatr"} onClick={() => { setBrand("chatr"); setBranchCode("all"); }}>ชาทรตะโหมด</FilterButton>
        <select
          value={branchCode}
          onChange={(event) => {
            setBranchCode(event.target.value);
            setBrand("all");
          }}
          className="h-9 rounded-full border border-red-200 bg-white px-3 text-sm"
        >
          <option value="all">เลือกสาขา</option>
          {branches.map((branch) => (
            <option key={branch.branch_code} value={branch.branch_code}>{branch.branch_code} {branch.branch_name}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((branch) => {
          const opening = branch.branch_code === "CT-BNP" ? branch.countdown_until ?? CT_BNP_OPENING : branch.countdown_until;
          const days = opening ? daysUntil(opening) : null;
          return (
            <article key={branch.id || branch.branch_code} className="rounded-xl border border-red-100 bg-white p-5">
              <p className="text-xs font-semibold text-red-700">{branch.branch_code}</p>
              <h2 className="text-lg font-semibold text-slate-900">{branch.branch_name}</h2>
              <p className="text-sm text-slate-500">{branch.brand_name ?? branch.brand_code}</p>
              {branch.branch_code === "CT-BNP" && days != null ? (
                <p className="mt-3 text-sm font-medium text-red-800">
                  นับถอยหลังเปิดสาขา 26 ธ.ค. 2569 อีก {Math.max(days, 0)} วัน
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-red-700 text-white" : "bg-white text-red-800 ring-1 ring-red-200"}`}
    >
      {children}
    </button>
  );
}
