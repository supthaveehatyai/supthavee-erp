"use client";

import { useMemo, useState, useTransition } from "react";
import { submitBlindCountAction, transferFnbStockAction } from "@/lib/actions/fnb-inventory";
import type { FnbBranchOption, FnbStockBalanceRow } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

export function InventoryWorkspace({
  branches,
  balances,
}: {
  branches: FnbBranchOption[];
  balances: FnbStockBalanceRow[];
}) {
  const [branch, setBranch] = useState(branches[0]?.branch_code ?? "");
  const [message, setMessage] = useState("");
  const [report, setReport] = useState("");
  const [pending, start] = useTransition();
  const rows = useMemo(() => balances.filter((row) => row.branch_code === branch), [balances, branch]);
  const sameEntity = branches.filter((item) => item.legal_entity_id && item.legal_entity_id === branches.find((row) => row.branch_code === branch)?.legal_entity_id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">สต็อกสาขา โอนของ และนับแบบปิดตา</h1>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>
        {branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code} {item.branch_name_th}</option>)}
      </select>
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-red-50 text-left"><tr><th className="p-2">รหัส</th><th className="p-2">ชื่อ</th><th className="p-2">หน่วยนับ</th><th className="p-2">หน่วยสูตร</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.item_id} className="border-t">
                <td className="p-2">{row.short_code}</td>
                <td className="p-2">{row.name_th}</td>
                <td className="p-2">{(row.on_hand_recipe / (row.recipe_per_count_uom || 1)).toFixed(2)} {row.count_uom}</td>
                <td className="p-2">{row.on_hand_recipe.toFixed(2)} {row.recipe_uom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const saved = await transferFnbStockAction({
            from_branch_code: branch,
            to_branch_code: String(form.get("to_branch_code") ?? ""),
            staff_name: String(form.get("staff_name") ?? ""),
            item_id: String(form.get("item_id") ?? ""),
            qty_in_count_uom: Number(form.get("qty") ?? 0),
          });
          setMessage(saved.error ?? `โอน ${saved.data.transfer_no} แล้ว`);
        });
      }}>
        <h2 className="font-semibold md:col-span-2">โอนข้ามสาขาในนิติบุคคลเดียวกัน</h2>
        <select className={field} name="to_branch_code">{sameEntity.filter((item) => item.branch_code !== branch).map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}</select>
        <select className={field} name="item_id">{rows.map((row) => <option key={row.item_id} value={row.item_id}>{row.short_code}</option>)}</select>
        <input className={field} name="qty" type="number" step="0.01" placeholder="จำนวนหน่วยนับ" />
        <input className={field} name="staff_name" placeholder="ผู้โอน" required />
        <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>บันทึกโอน</button>
      </form>
      <form className="space-y-2 rounded-xl border bg-white p-4" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const lines = rows.map((row) => ({
          item_id: row.item_id,
          closed_pack_count: Number(form.get(`closed_${row.item_id}`) ?? 0),
          open_pack_weight_g: Number(form.get(`open_${row.item_id}`) ?? 0),
        })).filter((line) => line.closed_pack_count || line.open_pack_weight_g);
        start(async () => {
          const saved = await submitBlindCountAction({ branch_code: branch, staff_name: String(form.get("staff_name") ?? ""), lines });
          setMessage(saved.error ?? `นับ ${saved.data.count_no} แล้ว`);
          setReport(saved.data.lines.map((line) => `${line.short_code} นับ ${line.counted.toFixed(2)} ระบบ ${line.system.toFixed(2)} ส่วนต่าง ${line.variance.toFixed(2)} บาท ${line.cost.toFixed(2)}`).join("\n"));
        });
      }}>
        <h2 className="font-semibold">นับสต็อกแบบปิดตา</h2>
        <p className="text-sm text-slate-500">กรอกจำนวนแพ็กปิดและน้ำหนักแพ็กเปิด ระบบจะเทียบกับยอดในบัญชีหลังกดบันทึก และแปลงน้ำหนักด้วยความถ่วงจำเพาะ</p>
        <input className={field} name="staff_name" placeholder="ผู้ตรวจนับ" required />
        {rows.map((row) => (
          <div key={row.item_id} className="grid gap-2 md:grid-cols-3">
            <p className="text-sm">{row.short_code}</p>
            <input className={field} name={`closed_${row.item_id}`} type="number" step="0.01" placeholder="แพ็กปิด" />
            <input className={field} name={`open_${row.item_id}`} type="number" step="0.01" placeholder="น้ำหนักแพ็กเปิด (g)" />
          </div>
        ))}
        <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>ส่งใบนับ</button>
        {report ? <pre className="whitespace-pre-wrap text-sm">{report}</pre> : null}
      </form>
    </div>
  );
}
