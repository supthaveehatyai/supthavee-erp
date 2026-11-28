"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { getShiftConsumerBehaviorAction } from "@/lib/actions/fnb-shift-handover";
import { getMenuAnalyticsAction } from "@/lib/actions/fnb-menu-sales";
import { getWipCostAnalyticsAction } from "@/lib/actions/fnb-wip";
import type { FnbBrandCode, FnbMenuRank, FnbPromoHint, FnbShiftBehavior, FnbWipCostRow } from "@/types/fnb";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

export function AnalyticsWorkspace({ brand }: { brand: FnbBrandCode }) {
  const [start, setStart] = useState(today().slice(0, 8) + "01");
  const [end, setEnd] = useState(today());
  const [ranks, setRanks] = useState<FnbMenuRank[]>([]);
  const [promos, setPromos] = useState<FnbPromoHint[]>([]);
  const [costs, setCosts] = useState<FnbWipCostRow[]>([]);
  const [pending, startTransition] = useTransition();
  const [behaviorBranch, setBehaviorBranch] = useState("");
  const [behavior, setBehavior] = useState<FnbShiftBehavior[]>([]);
  const branches = [...new Set(ranks.map((row) => row.branch_code))];
  const branchChoices = brand === "LUCKY_CUP" ? ["LC-HDY", "LC-PSU"] : ["CT-KLN", "CT-BNP", "CT-NMM"];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">วิเคราะห์เมนูขายดีและจัดโปรรายสาขา</h1>
      <section className="space-y-3 rounded-xl border border-amber-200 bg-white p-4">
        <h2 className="text-lg font-semibold">☀️ vs 🌤️ วิเคราะห์พฤติกรรมผู้บริโภค ช่วงเช้า เทียบ ช่วงบ่าย</h2>
        <form className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const loaded = await getShiftConsumerBehaviorAction({ brand, branchCode: behaviorBranch, startDate: start, endDate: end });
            if (loaded.error) toast.error(loaded.error);
            else setBehavior(loaded.data);
          });
        }}>
          <span className="flex h-10 items-center rounded-full bg-red-50 px-3 text-sm">{brand === "LUCKY_CUP" ? "🔴 Lucky Cup" : "🍷 ชาทรตะโหมด"}</span>
          <input className="h-10 rounded-md border px-3" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          <input className="h-10 rounded-md border px-3" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          <select className="h-10 rounded-md border px-3" value={behaviorBranch} onChange={(event) => setBehaviorBranch(event.target.value)}>
            <option value="">รวมทุกสาขา</option>
            {branchChoices.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending}>เปรียบเทียบเช้ากับบ่าย</button>
        </form>
        {behavior.map((row) => {
          const sales = row.morningSales + row.afternoonSales;
          const cups = row.morningCups + row.afternoonCups;
          const morningBill = row.morningOrders > 0 ? row.morningSales / row.morningOrders : 0;
          const afternoonBill = row.afternoonOrders > 0 ? row.afternoonSales / row.afternoonOrders : 0;
          const share = (part: number) => sales > 0 ? `${((part / sales) * 100).toFixed(0)}%` : "0%";
          return (
            <article key={row.branchCode} className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-amber-50 p-3 text-sm">
                <p className="font-semibold">☀️ {row.branchCode} ช่วงเช้า</p>
                <p>ยอดขาย {row.morningSales.toFixed(2)} · แก้ว {row.morningCups.toFixed(0)} · บิล {row.morningOrders.toFixed(0)} · เฉลี่ยต่อบิล {morningBill.toFixed(2)}</p>
                <p>หน้าร้าน Cash+QR {row.morningStore.toFixed(2)} · LineMan+Grab {row.morningDelivery.toFixed(2)} · LuckyCup App {row.morningApp.toFixed(2)}</p>
                <p>สัดส่วนยอด {share(row.morningSales)}</p>
              </div>
              <div className="rounded-lg bg-sky-50 p-3 text-sm">
                <p className="font-semibold">🌤️ {row.branchCode} ช่วงบ่าย</p>
                <p>ยอดขาย {row.afternoonSales.toFixed(2)} · แก้ว {row.afternoonCups.toFixed(0)} · บิล {row.afternoonOrders.toFixed(0)} · เฉลี่ยต่อบิล {afternoonBill.toFixed(2)}</p>
                <p>หน้าร้าน Cash+QR {row.afternoonStore.toFixed(2)} · LineMan+Grab {row.afternoonDelivery.toFixed(2)} · LuckyCup App {row.afternoonApp.toFixed(2)}</p>
                <p>สัดส่วนยอด {share(row.afternoonSales)} · รวมแก้ว {cups.toFixed(0)}</p>
              </div>
              <div className="overflow-x-auto md:col-span-2">
                <table className="min-w-full text-left text-xs">
                  <thead><tr><th>เมนู</th><th>หมวดหมู่</th><th>ไซส์</th><th>☀️ แก้วช่วงเช้า</th><th>🌤️ แก้วช่วงบ่าย</th><th>รวมทั้งวัน</th><th>ช่วงเวลาขายดีหลัก</th></tr></thead>
                  <tbody>
                    {row.menus.map((menu) => (
                      <tr key={`${menu.name}-${menu.cupSize}`} className="border-t">
                        <td>{menu.name}</td>
                        <td>{menu.category}</td>
                        <td>{menu.cupSize}</td>
                        <td>{menu.morningQty.toFixed(0)}</td>
                        <td>{menu.afternoonQty.toFixed(0)}</td>
                        <td>{menu.totalQty.toFixed(0)}</td>
                        <td>{menu.peak === "MORNING" ? "☀️ เช้า" : menu.peak === "AFTERNOON" ? "🌤️ บ่าย" : "ทั้งสองช่วง"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </section>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const [loaded, wip] = await Promise.all([getMenuAnalyticsAction(start, end), getWipCostAnalyticsAction(start, end)]);
          if (loaded.error) toast.error(loaded.error);
          else toast.success("โหลดยอดขายรายเมนูแล้ว");
          const keep = (code: string) => brand === "LUCKY_CUP" ? code.startsWith("LC") : code.startsWith("CT");
          setRanks(loaded.data.ranks.filter((row) => keep(row.branch_code)));
          setPromos(loaded.data.promos.filter((row) => keep(row.branch_code)));
          setCosts(wip.data.filter((row) => keep(row.branch_code)));
        });
      }}>
        <input className="h-10 rounded-md border px-3" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        <input className="h-10 rounded-md border px-3" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending}>{pending ? "กำลังโหลด..." : "เปรียบเทียบช่วงวันที่"}</button>
      </form>
      {branches.map((branch) => {
        const rows = ranks.filter((row) => row.branch_code === branch);
        const cups = rows.reduce((sum, row) => sum + row.qty_sold, 0);
        const revenue = rows.reduce((sum, row) => sum + row.gross_amount, 0);
        const sizeR = rows.filter((row) => row.cup_size === "R").reduce((sum, row) => sum + row.qty_sold, 0);
        const sizeL = rows.filter((row) => row.cup_size === "L").reduce((sum, row) => sum + row.qty_sold, 0);
        const categories = new Map<string, number>();
        for (const row of rows) categories.set(row.category_name || "ไม่ระบุหมวด", (categories.get(row.category_name || "ไม่ระบุหมวด") ?? 0) + row.gross_amount);
        return (
          <section key={branch} className="rounded-xl border bg-white p-4">
            <h2 className="font-semibold">{branch}</h2>
            <p className="text-sm">แก้วรวม {cups.toFixed(0)} · ยอดเงิน {revenue.toFixed(2)} · ไซส์ R {sizeR.toFixed(0)} / L {sizeL.toFixed(0)}</p>
            <p className="text-sm">สัดส่วนหมวด { [...categories.entries()].map(([name, amount]) => `${name} ${revenue ? ((amount / revenue) * 100).toFixed(1) : "0"}%`).join(" · ") }</p>
            <ol className="mt-2 list-decimal pl-5 text-sm">
              {rows.slice().sort((a, b) => b.qty_sold - a.qty_sold).slice(0, 8).map((row) => (
                <li key={`${row.menu_name_th}-${row.cup_size}`}>{row.menu_name_th} {row.cup_size ?? ""} · {row.qty_sold.toFixed(0)} แก้ว · {row.gross_amount.toFixed(2)} บาท</li>
              ))}
            </ol>
          </section>
        );
      })}
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">วิเคราะห์ต้นทุนเบิกทำเบส vs ความสูญเสียรายวันและรอบอายุหลายวัน</h2>
        {costs.length === 0 ? <p className="text-sm">ยังไม่มียอดเบิกขึ้นบาร์ในช่วงวันที่นี้</p> : costs.map((row) => (
          <article key={row.branch_code} className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-semibold">{row.branch_code}</p>
            <p>ต้นทุนวัตถุดิบเบิกขึ้นบาร์รวม {row.issued_cost.toFixed(2)} บาท</p>
            <p>ต้นทุนขายตามเมนูจริง {row.sold_cogs.toFixed(2)} บาท</p>
            <p>ความสูญเสียรายวันกลุ่มต้มสด/เลมอน {row.eod_waste.toFixed(2)} บาท ({row.eod_waste_pct.toFixed(1)}%)</p>
            <p>ต้นทุนส่วนตัดเต็มถุงจากการต้มครึ่งสูตรช่วงเย็น {row.franchise_rule_cost.toFixed(2)} บาท</p>
            <p>ความสูญเสียตามรอบอายุเปิดกล่อง {row.multi_day_waste.toFixed(2)} บาท ({row.multi_day_waste_pct.toFixed(1)}%)</p>
            <p>ส่วนต่างตวงเกิน/หกหล่นหน้าบาร์ {row.unexplained.toFixed(2)} บาท</p>
          </article>
        ))}
      </section>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-semibold">โปรแนะนำจากล็อตที่หมดอายุภายใน 14 วัน</h2>
        {promos.length === 0 ? <p className="text-sm">ยังไม่มีล็อตที่จับคู่กับสูตรเมนูได้</p> : promos.map((row, index) => (
          <p key={`${row.branch_code}-${row.menu_name_th}-${index}`} className="text-sm">{row.branch_code}: {row.item_name} หมดอายุ {row.expiry_date} (อีก {row.days_left} วัน) แนะนำโปรโมต {row.menu_name_th}</p>
        ))}
      </section>
    </div>
  );
}
