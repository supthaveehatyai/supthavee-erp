"use client";

import { useMemo } from "react";
import type { FnbBranchRow } from "@/types/holding";
import type { FnbBranchKpi, FnbChangeRequestRow, FnbExpiryAlert, FnbParLevelRow, FnbWipCostRow } from "@/types/fnb";
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
  approvals,
  parAlerts,
  expiryAlerts,
  wipCosts,
}: {
  branches: FnbBranchRow[];
  kpis: FnbBranchKpi[];
  schemaMessage: string | null;
  initialTab: string;
  approvals: FnbChangeRequestRow[];
  parAlerts: FnbParLevelRow[];
  expiryAlerts: FnbExpiryAlert[];
  wipCosts: FnbWipCostRow[];
}) {
  const totals = useMemo(() => {
    const codes = new Set(branches.map((branch) => branch.branch_code));
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
  }, [kpis, branches]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-red-700">FB</p>
        <h1 className="text-2xl font-bold text-slate-900">ภาพรวม & ยอดขาย 5 สาขา</h1>
        <p className="text-sm text-slate-500">Lucky Cup และชาทรตะโหมด รวม {branches.length} สาขา</p>
      </div>
      {schemaMessage ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{schemaMessage}</div> : null}
      <ApprovalQueue requests={approvals} />
      {parAlerts.length > 0 ? (
        <article className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <h2 className="font-semibold">🚨 วัตถุดิบและของใช้ต่ำกว่าจุดสั่งซื้อ (ต้องสั่งเพิ่มด่วน)</h2>
          {parAlerts.map((row) => <p key={`${row.branch_code}-${row.item_id}`}>{row.branch_code} · {row.name_th || row.short_code} คงเหลือ {row.last_observed_count_qty ?? 0} จุดต่ำสุด {row.min_par_count_qty}</p>)}
        </article>
      ) : null}
      {expiryAlerts.length > 0 ? (
        <article className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h2 className="font-semibold">⏰ แจ้งเตือนล็อตวัตถุดิบใกล้หมดอายุ (ล่วงหน้า 14 วัน / 7 วัน / หมดอายุ)</h2>
          {expiryAlerts.map((row, index) => <p key={`${row.branch_code}-${row.expiry_date}-${index}`}>{row.branch_code} · {row.name_th} หมดอายุ {row.expiry_date} {row.days_left < 0 ? "หมดอายุแล้ว" : row.days_left <= 7 ? `อีก ${row.days_left} วัน` : `อีก ${row.days_left} วัน`}</p>)}
        </article>
      ) : null}
      {wipCosts.length > 0 ? (
        <article className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">วิเคราะห์ต้นทุนเบิกทำเบส vs ความสูญเสียวันนี้</h2>
          {wipCosts.map((row) => <p key={row.branch_code}>{row.branch_code}: เบิก {baht(row.issued_cost)} · ขาย {baht(row.sold_cogs)} · ทิ้งปิดร้าน {baht(row.eod_waste)} · ตัดเต็มถุงครึ่งสูตร {baht(row.franchise_rule_cost)} · ของเสียหลายวัน {baht(row.multi_day_waste)} · ส่วนต่างบาร์ {baht(row.unexplained)}</p>)}
        </article>
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi label="ยอดขายวันนี้" value={baht(totals.todaySales)} />
        <Kpi label="ยอดขายเดือนนี้" value={baht(totals.monthSales)} />
        <Kpi label="สด / QR / LineMan / Grab" value={`${baht(totals.cash)} · ${baht(totals.qr)} · ${baht(totals.lineman)} · ${baht(totals.grab)}`} />
        <Kpi label="ทุนของทิ้งเดือนนี้" value={baht(totals.wasteCost)} />
        <Kpi label="รอคุณจวงโอนคืน" value={baht(totals.pendingReimburse)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BrandColumn title="🔴 Lucky Cup" frame="border-[#DC2626]" tint="bg-red-50" branches={branches.filter((branch) => branch.brand_code === "LUCKY_CUP")} />
        <BrandColumn title="🍷 ชาทรตะโหมด" frame="border-[#6B0F1A]" tint="bg-[#FDF2F4]" branches={branches.filter((branch) => branch.brand_code === "CHATORN")} />
      </div>
    </div>
  );
}

function BrandColumn({ title, frame, tint, branches }: { title: string; frame: string; tint: string; branches: FnbBranchRow[] }) {
  return (
    <section className={`space-y-3 rounded-2xl border-2 ${frame} ${tint} p-4`}>
      <h2 className="text-lg font-bold">{title}</h2>
      {branches.map((branch) => {
        const opening = branch.branch_code === "CT-BNP" ? branch.countdown_until ?? CT_BNP_OPENING : branch.countdown_until;
        const days = opening ? daysUntil(opening) : null;
        return (
          <article key={branch.id || branch.branch_code} className={`rounded-xl border bg-white p-4 ${frame}`}>
            <p className="text-xs font-semibold">{branch.branch_code}</p>
            <h3 className="font-semibold">{branch.branch_name}</h3>
            {branch.branch_code === "CT-BNP" && days != null ? <p className="mt-2 text-sm">นับถอยหลังเปิดสาขา 26 ธ.ค. 2569 อีก {Math.max(days, 0)} วัน</p> : null}
          </article>
        );
      })}
    </section>
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

