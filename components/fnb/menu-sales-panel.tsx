"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { listBrandMenusAction, parseMenuSlipAction, saveMenuSalesAction } from "@/lib/actions/fnb-menu-sales";
import type { FnbBrandCode, FnbMenuSalesDraft, FnbMenuSalesLine } from "@/types/fnb";

const empty: FnbMenuSalesDraft = { summary_only: false, slip_printed_at: null, reported_total_qty: 0, reported_total_amount: 0, early_print_note: null, lines: [] };

export function MenuSalesPanel({
  branch,
  workDate,
  brand,
  actorSource,
}: {
  branch: string;
  workDate: string;
  brand: FnbBrandCode;
  actorSource: "desktop" | "liff";
}) {
  const [draft, setDraft] = useState<FnbMenuSalesDraft>(empty);
  const [menus, setMenus] = useState<{ id: string; menu_name_th: string; cup_size: string }[]>([]);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    void listBrandMenusAction(brand).then((listed) => setMenus(listed.data));
  }, [brand]);

  function save(source: "OCR_SLIP" | "MANUAL_GRID") {
    setBusy(true);
    start(async () => {
      const saved = await saveMenuSalesAction({
        branch_code: branch,
        work_date: workDate,
        brand_lock: brand,
        actor_source: actorSource,
        entry_source: source,
        draft,
        edit_reason: reason,
      });
      setBusy(false);
      if (saved.error) {
        toast.error(saved.error);
        setMessage(saved.error);
        return;
      }
      toast.success("บันทึกยอดขายรายเมนูแล้ว");
      setMessage("บันทึกยอดขายรายเมนูแล้ว");
    });
  }

  const visible = menus.filter((menu) => `${menu.menu_name_th} ${menu.cup_size}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12);

  return (
    <section className="space-y-3 rounded-xl border border-red-100 bg-white p-4">
      <h2 className="font-semibold">🍹 รายงานยอดขายรายเมนู (สแกนสลิป POS / กรอกตาราง)</h2>
      {message ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}
      {draft.summary_only ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">สลิปนี้เป็นแบบจัดกลุ่มตามสินค้า กรุณาอัปโหลดสลิปจัดกลุ่มตามสินค้าและหมวดหมู่</p> : null}
      {draft.early_print_note ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{draft.early_print_note}</p> : null}
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget);
        body.set("actor_source", actorSource);
        body.set("brand_lock", brand);
        body.set("branch_code", branch);
        body.set("work_date", workDate);
        setBusy(true);
        start(async () => {
          const parsed = await parseMenuSlipAction(body);
          setBusy(false);
          if (parsed.error) {
            toast.error(parsed.error);
            setMessage(parsed.error);
            return;
          }
          setDraft(parsed.data);
          toast.success(`อ่านได้ ${parsed.data.lines.length} รายการ`);
        });
      }}>
        <label className="block rounded-lg border border-dashed p-3 text-sm" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => event.preventDefault()}>
          ถ่ายหรืออัปโหลดสลิปได้ 1 ถึง 3 รูป
          <input className="mt-2 block" name="slips" type="file" accept="image/*" capture="environment" multiple />
        </label>
        <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={busy}>{busy ? "กำลังอ่าน..." : "อ่านสลิปรายเมนู"}</button>
      </form>
      <div className="space-y-2">
        <input className="h-10 w-full rounded-md border px-3 text-sm" value={query} placeholder="ค้นหาเมนูเพื่อกรอกจำนวน" onChange={(event) => setQuery(event.target.value)} />
        {visible.map((menu) => (
          <button type="button" key={menu.id} className="block text-left text-sm text-red-800" onClick={() => setDraft((current) => ({
            ...current,
            lines: [...current.lines, { line_seq: current.lines.length + 1, menu_id: menu.id, menu_name_th: menu.menu_name_th, category_name: null, cup_size: menu.cup_size || null, qty_sold: 1, gross_amount: 0 }],
          }))}>+ {menu.menu_name_th} {menu.cup_size}</button>
        ))}
        <button type="button" className="text-sm text-red-700" onClick={() => setDraft((current) => ({
          ...current,
          lines: [...current.lines, { line_seq: current.lines.length + 1, menu_id: null, menu_name_th: "", category_name: null, cup_size: null, qty_sold: 0, gross_amount: 0 }],
        }))}>+ เพิ่มเมนูใหม่</button>
        {draft.lines.map((line, index) => (
          <div key={`${line.line_seq}-${index}`} className="grid gap-2 md:grid-cols-4">
            <input className="h-10 rounded-md border px-3 text-sm" value={line.menu_name_th} onChange={(event) => updateLine(setDraft, index, { menu_name_th: event.target.value })} />
            <input className="h-10 rounded-md border px-3 text-sm" value={line.cup_size ?? ""} placeholder="R/L" onChange={(event) => updateLine(setDraft, index, { cup_size: event.target.value.toUpperCase() || null })} />
            <input className="h-10 rounded-md border px-3 text-sm" type="number" value={line.qty_sold} onChange={(event) => updateLine(setDraft, index, { qty_sold: Number(event.target.value) || 0 })} />
            <input className="h-10 rounded-md border px-3 text-sm" type="number" value={line.gross_amount} onChange={(event) => updateLine(setDraft, index, { gross_amount: Number(event.target.value) || 0 })} />
          </div>
        ))}
        <input className="h-10 w-full rounded-md border px-3 text-sm" value={reason} placeholder="สาเหตุการแก้ไข หากบันทึกวันนี้ไปแล้ว" onChange={(event) => setReason(event.target.value)} />
        <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" disabled={busy} onClick={() => save(draft.slip_printed_at ? "OCR_SLIP" : "MANUAL_GRID")}>{busy ? "กำลังบันทึก..." : "บันทึกยอดขายรายเมนู"}</button>
      </div>
    </section>
  );
}

function updateLine(setDraft: (value: FnbMenuSalesDraft | ((current: FnbMenuSalesDraft) => FnbMenuSalesDraft)) => void, index: number, patch: Partial<FnbMenuSalesLine>) {
  setDraft((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) }));
}
