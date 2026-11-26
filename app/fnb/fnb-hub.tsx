"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { FnbBranchRow } from "@/types/holding";
import type { FnbBranchKpi, FnbChangeRequestRow } from "@/types/fnb";
import { ApprovalQueue } from "@/app/fnb/approval-queue";

const CT_BNP_OPENING = "2026-12-26";

function daysUntil(iso: string): number {
  const target = new Date(`${iso.slice(0, 10)}T00:00:00+07:00`);
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

function baht(amount: number): string {
  return `฿${amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FnbHub({
  branches,
  kpis,
  schemaMessage,
  initialTab,
  approvals,
}: {
  branches: FnbBranchRow[];
  kpis: FnbBranchKpi[];
  schemaMessage: string | null;
  initialTab: string;
  approvals: FnbChangeRequestRow[];
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
  const totals = useMemo(() => {
    const codes = new Set(visible.map((branch) => branch.branch_code));
    return kpis.filter((row) => codes.has(row.branch_code)).reduce(
      (sum, row) => ({
        todaySales: sum.todaySales + row.todaySales,
        monthSales: sum.monthSales + row.monthSales,
        cash: sum.cash + row.cash,
        qr: sum.qr + row.qr,
        lineman: sum.lineman + row.lineman,
        grab: sum.grab + row.grab,
        wasteCost: sum.wasteCost + row.wasteCost,
        pendingReimburse: sum.pendingReimburse + row.pendingReimburse,
      }),
      { todaySales: 0, monthSales: 0, cash: 0, qr: 0, lineman: 0, grab: 0, wasteCost: 0, pendingReimburse: 0 },
    );
  }, [kpis, visible]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-red-700">FB</p>
        <h1 className="text-2xl font-bold text-slate-900">ภาพรวม & ยอดขาย 5 สาขา</h1>
        <p className="text-sm text-slate-500">Lucky Cup และชาทรตะโหมด รวม {branches.length} สาขา</p>
      </div>
      {schemaMessage ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{schemaMessage}</div> : null}
      <ApprovalQueue requests={approvals} />
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
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi label="ยอดขายวันนี้" value={baht(totals.todaySales)} />
        <Kpi label="ยอดขายเดือนนี้" value={baht(totals.monthSales)} />
        <Kpi label="สด / QR / LineMan / Grab" value={`${baht(totals.cash)} · ${baht(totals.qr)} · ${baht(totals.lineman)} · ${baht(totals.grab)}`} />
        <Kpi label="ทุนของทิ้งเดือนนี้" value={baht(totals.wasteCost)} />
        <Kpi label="รอคุณจวงโอนคืน" value={baht(totals.pendingReimburse)} />
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-red-100 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </article>
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
