"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  depleteExpiryLotAction,
  markReimbursementsPaidAction,
  parseFnbBillImageAction,
  previewVendorSheetAction,
  saveExpiryLotsAction,
  submitBlindGoodsReceiptAction,
} from "@/lib/actions/fnb-procurement";
import { listBranchZonesAction } from "@/lib/actions/fnb-store-day";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { itemMatches } from "@/lib/fnb/item-search";
import type { FnbBranchOption, FnbBrandCode, FnbExpiryLotRow, FnbItemRow, FnbReimbursementRow, FnbUnpackLine, FnbVendorSheetRow } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

export function ProcurementWorkspace({
  branches,
  items,
  pending,
  lots,
  payouts,
  showGoods = true,
  showPayout = true,
  revealCost = true,
  brand,
}: {
  branches: FnbBranchOption[];
  items: Pick<FnbItemRow, "id" | "short_code" | "name_th" | "default_purchase_uom" | "recipe_per_purchase_uom" | "allow_decimal_count_qty" | "count_uom">[];
  brand: FnbBrandCode;
  pending: FnbUnpackLine[];
  lots: FnbExpiryLotRow[];
  payouts: FnbReimbursementRow[];
  showGoods?: boolean;
  showPayout?: boolean;
  revealCost?: boolean;
}) {
  const [tab, setTab] = useState<"scan" | "manual" | "lots" | "pay">(showGoods ? "scan" : "pay");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">รับของเข้าและชนบิลภาษี</h1>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {showGoods ? <Tab active={tab === "scan"} onClick={() => setTab("scan")}>สแกนบิล / นำเข้าใบสั่งของ</Tab> : null}
        {showGoods ? <Tab active={tab === "manual"} onClick={() => setTab("manual")}>รับวัตถุดิบเข้าด่วน</Tab> : null}
        {showGoods ? <Tab active={tab === "lots"} onClick={() => setTab("lots")}>แกะกล่องลงวันหมดอายุ</Tab> : null}
        {showPayout ? <Tab active={tab === "pay"} onClick={() => setTab("pay")}>คิวโอนคืนพนักงาน</Tab> : null}
      </div>
      {tab === "scan" && showGoods ? <ScanTab branches={branches} items={items} setMessage={setMessage} /> : null}
      {tab === "manual" && showGoods ? <ManualReceive branches={branches} items={items} brandLock={brand} revealCost={revealCost} setMessage={setMessage} /> : null}
      {tab === "lots" && showGoods ? <ExpiryPanel pending={pending} lots={lots} brandLock={brand} /> : null}
      {tab === "pay" && showPayout ? <PayoutQueue payouts={payouts} setMessage={setMessage} /> : null}
    </div>
  );
}

function ScanTab({
  branches,
  items,
  setMessage,
}: {
  branches: FnbBranchOption[];
  items: Pick<FnbItemRow, "id" | "short_code" | "name_th" | "default_purchase_uom" | "recipe_per_purchase_uom">[];
  setMessage: (message: string) => void;
}) {
  const [rows, setRows] = useState<FnbVendorSheetRow[]>([]);
  const [branch, setBranch] = useState(branches.find((item) => item.brand_code === "LUCKY_CUP")?.branch_code ?? branches[0]?.branch_code ?? "");
  const [vendor, setVendor] = useState("");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const file = event.dataTransfer.files?.[0]; if (file) read(file); }}>
      <p className="text-sm text-slate-600">วางรูปบิลหรือไฟล์ Excel เช่น 19 店 - SuperDan</p>
      <input type="file" accept="image/*,.pdf,.xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) read(file); }} />
      <div className="grid gap-2 md:grid-cols-2">
        <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}</select>
        <input className={field} value={vendor} placeholder="ผู้ขาย" onChange={(event) => setVendor(event.target.value)} />
      </div>
      {rows.map((row, index) => (
        <div key={`${row.external_code}-${index}`} className="grid gap-2 text-sm md:grid-cols-4">
          <p>{row.external_code || row.raw_desc}</p>
          <p>{row.item_name ?? "ยังไม่จับคู่"} · {row.received_qty} {row.received_uom}</p>
          <p>{row.unit_price.toFixed(2)}</p>
        </div>
      ))}
      <SaveButton busy={busy} onClick={() => {
        const body = new FormData();
        body.set("receiving_branch_code", branch);
        body.set("actor_source", "desktop");
        body.set("vendor_name", vendor);
        body.set("reveal_cost", "true");
        body.set("lines_json", JSON.stringify(rows.filter((row) => row.item_id).map((row) => ({
          item_id: row.item_id,
          raw_desc: row.raw_desc,
          raw_code: row.raw_code,
          received_qty: row.received_qty || 1,
          received_uom: row.received_uom,
          unit_price: row.unit_price,
          line_vat_mode: "EX_VAT",
        }))));
        setBusy(true);
        start(async () => {
          const saved = await submitBlindGoodsReceiptAction(body);
          setBusy(false);
          if (saved.error) { toast.error(saved.error); setMessage(saved.error); }
          else { toast.success(`บันทึกรับวัตถุดิบเข้าคลัง ${saved.data.gr_no} แล้ว`); setMessage(`บันทึก ${saved.data.gr_no} แล้ว รายการที่ต้องคุมวันหมดอายุจะไปรอแกะกล่อง`); }
        });
      }}>บันทึกรับวัตถุดิบเข้าคลัง</SaveButton>
    </section>
  );

  function read(file: File) {
    const body = new FormData();
    body.set("file", file);
    setBusy(true);
    start(async () => {
      if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {
        const parsed = await previewVendorSheetAction(body);
        setRows(parsed.data.rows);
        if (parsed.data.branch_code) setBranch(parsed.data.branch_code);
        setBusy(false);
        if (parsed.error) { toast.error(parsed.error); setMessage(parsed.error); }
        else toast.success(`อ่านได้ ${parsed.data.rows.length} รายการ`);
        return;
      }
      const parsed = await parseFnbBillImageAction(body);
      setVendor(parsed.data.vendor_name);
      setRows(parsed.data.lines.map((line) => {
        const item = items.find((candidate) => candidate.name_th.includes(line.name) || line.name.includes(candidate.short_code));
        return {
          raw_code: "",
          raw_desc: line.name,
          received_qty: line.qty,
          received_uom: line.uom || item?.default_purchase_uom || "",
          unit_price: line.price,
          external_code: item?.short_code ?? "",
          item_id: item?.id ?? null,
          item_name: item?.name_th ?? null,
        };
      }));
      setBusy(false);
      if (parsed.error) { toast.error(parsed.error); setMessage(parsed.error); }
      else toast.success(`อ่านบิลได้ ${parsed.data.lines.length} รายการ`);
    });
  }
}

export function ManualReceive({
  branches,
  items,
  brandLock,
  revealCost,
  actorSource = "desktop",
  setMessage,
}: {
  branches: FnbBranchOption[];
  items: Pick<FnbItemRow, "id" | "short_code" | "name_th" | "default_purchase_uom" | "recipe_per_purchase_uom" | "allow_decimal_count_qty" | "count_uom">[];
  brandLock: FnbBrandCode | null;
  revealCost: boolean;
  actorSource?: "desktop" | "liff";
  setMessage?: (message: string) => void;
}) {
  const [lines, setLines] = useState([{ item_id: items[0]?.id ?? "", qty: "", uom: items[0]?.default_purchase_uom ?? "" }]);
  const [query, setQuery] = useState("");
  const [zones, setZones] = useState<{ locationCode: string; locationNameTh: string; isDefaultGrTarget: boolean }[]>([]);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const visible = items.filter((item) => itemMatches(query, item));
  useEffect(() => {
    const branch = branches[0]?.branch_code;
    if (!branch) return;
    void listBranchZonesAction(branch).then((loaded) => {
      const next = loaded.data.map((row) => ({ locationCode: row.locationCode, locationNameTh: row.locationNameTh, isDefaultGrTarget: row.isDefaultGrTarget }));
      setZones(next);
      setLocation(next.find((row) => row.isDefaultGrTarget)?.locationCode ?? next[0]?.locationCode ?? "");
    });
  }, [branches]);
  return (
    <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      form.set("brand_lock", brandLock ?? "");
      form.set("actor_source", actorSource);
      form.set("reveal_cost", revealCost ? "true" : "false");
      form.set("lines_json", JSON.stringify(lines.map((line) => {
        const item = items.find((row) => row.id === line.item_id);
        return { item_id: line.item_id, raw_desc: item ? `${item.short_code} ${item.name_th}` : "", received_qty: Number(line.qty) || 0, received_uom: line.uom || item?.default_purchase_uom || "ชิ้น", recipe_qty_per_unit: item?.recipe_per_purchase_uom || 1, unit_price: 0 };
      })));
      setBusy(true);
      start(async () => {
        const saved = await submitBlindGoodsReceiptAction(form);
        setBusy(false);
        if (saved.error) { toast.error(saved.error); setMessage?.(saved.error); }
        else { toast.success(`รับของ ${saved.data.gr_no} เข้าคลังแล้ว`); setMessage?.(`รับของ ${saved.data.gr_no} แล้ว`); }
      });
    }}>
      <h2 className="font-semibold">รับวัตถุดิบเข้าด่วน</h2>
      <div className="grid gap-2 md:grid-cols-2">
        <select className={field} name="receiving_branch_code" onChange={(event) => { void listBranchZonesAction(event.target.value).then((loaded) => { const next = loaded.data.map((row) => ({ locationCode: row.locationCode, locationNameTh: row.locationNameTh, isDefaultGrTarget: row.isDefaultGrTarget })); setZones(next); setLocation(next.find((row) => row.isDefaultGrTarget)?.locationCode ?? next[0]?.locationCode ?? ""); }); }}>{branches.map((branch) => <option key={branch.branch_code} value={branch.branch_code}>{branch.branch_code} {branch.branch_name_th}</option>)}</select>
        <select className={field} name="target_location_code" value={location} onChange={(event) => setLocation(event.target.value)}>{zones.map((zone) => <option key={zone.locationCode} value={zone.locationCode}>รับเข้าเก็บที่ {zone.locationNameTh}</option>)}</select>
        <input className={`${field} md:col-span-2`} value={query} placeholder="ค้นรหัสย่อ รหัสเรียก หรือชื่อสินค้า" onChange={(event) => setQuery(event.target.value)} />
        <input className={field} name="vendor_name" placeholder="ผู้ขาย" />
      </div>
      {lines.map((line, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-3">
          <select className={field} value={line.item_id} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, item_id: event.target.value } : row))}>{(visible.some((item) => item.id === line.item_id) ? visible : items.filter((item) => item.id === line.item_id).concat(visible)).map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}</select>
          <FnbQtyInput value={line.qty} unit={items.find((item) => item.id === line.item_id)?.default_purchase_uom || "ชิ้น"} allowDecimal={items.find((item) => item.id === line.item_id)?.allow_decimal_count_qty === true} onChange={(value) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, qty: value } : row))} />
          <input className={field} placeholder="หน่วยรับ เช่น แกลลอน" value={line.uom} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, uom: event.target.value } : row))} />
        </div>
      ))}
      <button type="button" className="text-sm text-red-700" onClick={() => setLines((current) => [...current, { item_id: items[0]?.id ?? "", qty: "", uom: "" }])}>เพิ่มรายการ</button>
      <label className="block rounded-lg border border-dashed p-3 text-sm" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}>รูปของที่มาส่ง<input className="mt-2 block" name="photos" type="file" accept="image/*" capture="environment" multiple /></label>
      <SaveButton busy={busy}>บันทึกรับของ</SaveButton>
    </form>
  );
}

export function ExpiryPanel({ pending, lots, brandLock, actorSource = "desktop" }: { pending: FnbUnpackLine[]; lots: FnbExpiryLotRow[]; brandLock: FnbBrandCode | null; actorSource?: "desktop" | "liff" }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const line = pending.find((row) => row.id === openId) ?? null;
  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">รอแกะกล่องระบุวันหมดอายุ</h2>
        {pending.map((row) => {
          const remain = row.received_qty - row.allocated_lot_qty;
          return (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 p-3 text-sm">
              <p>{row.short_code} {row.name_th} · รับมา {row.received_qty} {row.received_uom} · ระบุแล้ว {row.allocated_lot_qty} · ค้างระบุ {remain} {row.received_uom}</p>
              <button type="button" className="rounded-md border px-3 py-1" onClick={() => setOpenId(row.id)}>แยกล็อตวันหมดอายุ</button>
            </div>
          );
        })}
        {line ? <LotSplitter line={line} brandLock={brandLock} busy={busy} onSave={(lotsToSave) => {
          setBusy(true);
          start(async () => {
            const saved = await saveExpiryLotsAction({ gr_line_id: line.id, staff_name: "", actor_source: actorSource, brand_lock: brandLock, lots: lotsToSave });
            setBusy(false);
            if (saved.error) toast.error(saved.error);
            else { toast.success("บันทึกล็อตวันหมดอายุแล้ว"); setOpenId(null); }
          });
        }} /> : null}
      </section>
      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">แผนการหยิบใช้วัตถุดิบ หมดอายุก่อนใช้ก่อน</h2>
        {lots.map((lot) => {
          const days = Math.ceil((new Date(`${lot.expiry_date}T00:00:00+07:00`).getTime() - Date.now()) / 86400000);
          const badge = days <= 7 ? "ใช้ก่อนด่วน" : days <= 30 ? "ใกล้ครบกำหนด" : "ปกติ";
          return (
            <div key={lot.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>{lot.short_code} {lot.name_th} · คงเหลือ {lot.remaining_pack_qty} {lot.pack_uom} · หมดอายุ {lot.expiry_date} · {badge} เหลือ {days} วัน</p>
              <button type="button" className="rounded-md border px-3 py-1" disabled={busy} onClick={() => {
                setBusy(true);
                start(async () => {
                  const saved = await depleteExpiryLotAction(lot.id);
                  setBusy(false);
                  if (saved.error) toast.error(saved.error);
                  else toast.success("ตัดล็อตที่ใช้หมดแล้ว");
                });
              }}>ตัดล็อตเมื่อใช้หมดแล้ว</button>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function LotSplitter({
  line,
  busy,
  onSave,
}: {
  line: FnbUnpackLine;
  brandLock: FnbBrandCode | null;
  busy: boolean;
  onSave: (lots: { pack_qty: number; mfg_date: string; expiry_date: string; shelf_life_months: number | null }[]) => void;
}) {
  const remain = line.received_qty - line.allocated_lot_qty;
  const [rows, setRows] = useState([{ qty: String(remain), mfg: "", expiry: "" }]);
  const months = line.shelf_life_months ?? 12;
  return (
    <form className="space-y-2 rounded-lg border border-red-100 p-3" onSubmit={(event) => {
      event.preventDefault();
      onSave(rows.map((row) => ({ pack_qty: Number(row.qty) || 0, mfg_date: row.mfg, expiry_date: row.expiry, shelf_life_months: line.shelf_life_months })));
    }}>
      <p className="text-sm">อายุเก็บรักษาตามมาตรฐาน: {months} เดือน นับจากวันผลิต</p>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-3">
          <input className={field} type="number" step="0.01" value={row.qty} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, qty: event.target.value } : item))} />
          <input className={field} type="date" value={row.mfg} onChange={(event) => {
            const mfg = event.target.value;
            const expiry = mfg ? addMonths(mfg, months) : row.expiry;
            setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, mfg, expiry } : item));
          }} />
          <input className={field} type="date" value={row.expiry} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, expiry: event.target.value } : item))} />
        </div>
      ))}
      <button type="button" className="text-sm text-red-700" onClick={() => {
        const used = rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
        setRows((current) => [...current, { qty: String(Math.max(remain - used, 0)), mfg: "", expiry: "" }]);
      }}>เพิ่มล็อต</button>
      <SaveButton busy={busy}>บันทึกล็อต</SaveButton>
    </form>
  );
}

function PayoutQueue({ payouts, setMessage }: { payouts: FnbReimbursementRow[]; setMessage: (message: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  return (
    <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      body.set("ids", picked.join(","));
      setBusy(true);
      start(async () => {
        const saved = await markReimbursementsPaidAction(body);
        setBusy(false);
        if (saved.error) { toast.error(saved.error); setMessage(saved.error); }
        else { toast.success(`โอนแล้ว ${saved.data.paid} รายการ`); setMessage(`โอนแล้ว ${saved.data.paid} รายการ`); }
      });
    }}>
      <h2 className="font-semibold">คิวโอนคืน 7-Eleven 15 บาท และเบิกซื้อด่วน</h2>
      {payouts.map((row) => <label key={row.id} className="flex gap-2 text-sm"><input type="checkbox" checked={picked.includes(row.id)} onChange={(event) => setPicked((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} />{row.reimb_no} · {row.staff_name} · {row.reimb_mode} · {row.total_amount.toFixed(2)}</label>)}
      <input name="slip" type="file" accept="image/*" />
      <SaveButton busy={busy}>ทำเครื่องหมายว่าโอนแล้ว</SaveButton>
    </form>
  );
}

function addMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`}>{children}</button>;
}

function SaveButton({ busy, children, onClick }: { busy: boolean; children: string; onClick?: () => void }) {
  return <button type={onClick ? "button" : "submit"} onClick={onClick} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white disabled:opacity-60">{busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}{busy ? "กำลังบันทึก..." : children}</button>;
}
