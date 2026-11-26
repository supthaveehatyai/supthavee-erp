"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { getMenuAnalyticsAction } from "@/lib/actions/fnb-menu-sales";
import type { FnbMenuRank, FnbPromoHint } from "@/types/fnb";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

export function AnalyticsWorkspace() {
  const [start, setStart] = useState(today().slice(0, 8) + "01");
  const [end, setEnd] = useState(today());
  const [ranks, setRanks] = useState<FnbMenuRank[]>([]);
  const [promos, setPromos] = useState<FnbPromoHint[]>([]);
  const [pending, startTransition] = useTransition();
  const branches = [...new Set(ranks.map((row) => row.branch_code))];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">วิเคราะห์เมนูขายดีและจัดโปรรายสาขา</h1>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const loaded = await getMenuAnalyticsAction(start, end);
          if (loaded.error) toast.error(loaded.error);
          else toast.success("โหลดยอดขายรายเมนูแล้ว");
          setRanks(loaded.data.ranks);
          setPromos(loaded.data.promos);
        });
      }}>
        <input className="h-10 rounded-md border px-3" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        <input className="h-10 rounded-md border px-3" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={pending}>{pending ? "กำลังโหลด..." : "เปรียบเทียบช่วงวันที่"}</button>
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
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-semibold">โปรแนะนำจากล็อตที่หมดอายุภายใน 14 วัน</h2>
        {promos.length === 0 ? <p className="text-sm">ยังไม่มีล็อตที่จับคู่กับสูตรเมนูได้</p> : promos.map((row, index) => (
          <p key={`${row.branch_code}-${row.menu_name_th}-${index}`} className="text-sm">{row.branch_code}: {row.item_name} หมดอายุ {row.expiry_date} (อีก {row.days_left} วัน) แนะนำโปรโมต {row.menu_name_th}</p>
        ))}
      </section>
    </div>
  );
}
