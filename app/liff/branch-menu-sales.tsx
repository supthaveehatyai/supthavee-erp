"use client";

import { useState } from "react";
import { getScopedBranchMenuSalesAction } from "@/lib/actions/fnb-menu-sales";
import type { FnbBranchOption, FnbScopedMenuSales } from "@/types/fnb";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

export function BranchMenuSales({ branches }: { branches: FnbBranchOption[] }) {
  const [branchCode, setBranchCode] = useState(branches[0]?.branch_code ?? "");
  const [dateFrom, setDateFrom] = useState(daysAgo(6));
  const [dateTo, setDateTo] = useState(today());
  const [report, setReport] = useState<FnbScopedMenuSales | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <section className="space-y-3 rounded-2xl bg-white p-3 shadow-sm">
      <h2 className="font-semibold text-slate-900">ยอดขายรายเมนูสาขา</h2>
      <div className="grid gap-2">
        <select className="h-10 rounded-lg border px-3 text-sm" value={branchCode} onChange={(event) => setBranchCode(event.target.value)}>
          {branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code} {item.branch_name_th}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input className="h-10 rounded-lg border px-3 text-sm" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          <input className="h-10 rounded-lg border px-3 text-sm" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </div>
        <button
          type="button"
          className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending || !branchCode}
          onClick={() => {
            setPending(true);
            void getScopedBranchMenuSalesAction({ branchCode, dateFrom, dateTo }).then((loaded) => {
              setReport(loaded.data);
              setMessage(loaded.error ?? "");
              setPending(false);
            });
          }}
        >
          {pending ? "กำลังโหลด..." : "ดูยอดขาย"}
        </button>
      </div>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      {report ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">จำนวนแก้วที่ขาย {report.totalCups.toLocaleString("th-TH")} · ยอดขายรวม {report.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} ฿</p>
          <div>
            <p className="mb-1 font-medium">หมวดหมู่ขายดี</p>
            {report.categories.map((item) => (
              <p key={item.name} className="text-slate-700">{item.name} · {item.qtySold.toLocaleString("th-TH")} แก้ว · {item.grossAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} ฿</p>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-red-50"><tr><th className="p-2">เมนู</th><th className="p-2">แก้ว</th><th className="p-2">ยอดขาย</th><th className="p-2">R / L</th>{report.showCost ? <th className="p-2">ทุนสูตร</th> : null}</tr></thead>
              <tbody>
                {report.menus.map((item) => {
                  const cups = item.qtyR + item.qtyL;
                  const share = cups > 0 ? `R ${Math.round((item.qtyR / cups) * 100)}% · L ${Math.round((item.qtyL / cups) * 100)}%` : "—";
                  return (
                    <tr key={item.menuName} className="border-t">
                      <td className="p-2">{item.menuName}<div className="text-xs text-slate-400">{item.categoryName}</div></td>
                      <td className="p-2">{item.qtySold.toLocaleString("th-TH")}</td>
                      <td className="p-2">{item.grossAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                      <td className="p-2">{share}</td>
                      {report.showCost ? <td className="p-2">{(item.estimatedBomCost ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
