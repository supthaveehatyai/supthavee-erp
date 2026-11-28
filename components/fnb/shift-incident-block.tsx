"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { WriteOffButton } from "@/components/fnb/write-off-panel";
import { listBranchMenusForSalesAction } from "@/lib/actions/fnb-pos-ocr";
import { uploadFnbEvidenceAction } from "@/lib/actions/fnb-sop";
import { listShiftIncidentsAction, recordShiftDrinkRemakeAction } from "@/lib/actions/fnb-shift-incidents";
import { useLiveBranch } from "@/components/fnb/shift-crew-bar";
import type { FnbBrandCode, FnbShiftIncidentView } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";
const MISTAKES = [
  ["WRONG_RECIPE_SWEETNESS", "ชงผิดสูตร/หวานผิด"],
  ["SPILLED", "ทำหก/ตกหล่น"],
  ["CUSTOMER_REMAKE", "ลูกค้าเคลมเปลี่ยนแก้ว"],
  ["SHOT_FAIL", "ช็อต/วัตถุดิบไม่ได้เกณฑ์เททิ้ง"],
  ["POS_KEY_ERROR", "คีย์ POS ผิด"],
] as const;

export function mistakeLabel(code: string): string {
  return MISTAKES.find((row) => row[0] === code)?.[1] || code;
}

export function ShiftDrinkRemakeModal(props: {
  open: boolean;
  onClose: () => void;
  branch: string;
  workDate: string;
  brand: FnbBrandCode;
  actorSource: "desktop" | "liff";
  staffName: string;
  shiftType: "MORNING" | "AFTERNOON";
  onDone: () => void;
}) {
  const live = useLiveBranch();
  const locked = props.shiftType;
  const [shift, setShift] = useState<"MORNING" | "AFTERNOON">(locked);
  const [menus, setMenus] = useState<{ id: string; name: string }[]>([]);
  const [menuId, setMenuId] = useState("");
  const [qty, setQty] = useState("1");
  const [category, setCategory] = useState<string>(MISTAKES[0][0]);
  const [brewer, setBrewer] = useState(props.staffName);
  const [photo, setPhoto] = useState("");
  useEffect(() => { setShift(props.shiftType); }, [props.shiftType, props.open]);
  useEffect(() => {
    if (!props.open) return;
    void listBranchMenusForSalesAction(props.branch).then((loaded) => {
      setMenus(loaded.data.map((row) => ({ id: row.id, name: row.name })));
      setMenuId(loaded.data[0]?.id ?? "");
    });
  }, [props.open, props.branch]);
  if (!props.open) return null;
  const supervisor = live.snapshot?.viewer.isSupervisor === true;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <form className="max-h-[90vh] w-full max-w-lg space-y-2 overflow-auto rounded-xl bg-white p-4" onClick={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault();
        if (!photo) { toast.error("ถ่ายรูปแก้วที่เสียหายก่อนเททิ้ง"); return; }
        void recordShiftDrinkRemakeAction({
          branchCode: props.branch,
          workDate: props.workDate,
          shiftType: shift,
          menuId,
          customMenuName: menus.find((row) => row.id === menuId)?.name || "",
          qtyCups: Math.trunc(Number(qty) || 1),
          mistakeCategory: category,
          mistakeStaffName: brewer,
          photoUrls: [photo],
          notes: "",
        }).then((saved) => {
          if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกทำเมนูผิดไม่สำเร็จ");
          else { toast.success(`${saved.data.incidentNo} · ต้นทุนเสีย ${saved.data.cost.toFixed(2)} ฿`); props.onDone(); props.onClose(); }
        });
      }}>
        <h3 className="font-semibold">🥤 แจ้งทำเมนูผิด / ชงใหม่</h3>
        <label className="text-sm">กะที่เกิดเหตุ
          <select className={field} value={shift} disabled={!supervisor} onChange={(event) => setShift(event.target.value === "AFTERNOON" ? "AFTERNOON" : "MORNING")}>
            <option value="MORNING">☀️ กะเช้า</option>
            <option value="AFTERNOON">🌤️ กะบ่าย</option>
          </select>
        </label>
        <label className="text-sm">เลือกเมนูที่ทำผิด
          <select className={field} value={menuId} onChange={(event) => setMenuId(event.target.value)}>{menus.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        </label>
        <label className="text-sm">จำนวนแก้ว<FnbQtyInput value={qty} onChange={setQty} unit="แก้ว" /></label>
        <label className="text-sm">สาเหตุ
          <select className={field} value={category} onChange={(event) => setCategory(event.target.value)}>{MISTAKES.map((row) => <option key={row[0]} value={row[0]}>{row[1]}</option>)}</select>
        </label>
        <label className="text-sm">ชื่อพนักงานผู้ชง<input className={field} value={brewer} onChange={(event) => setBrewer(event.target.value)} /></label>
        <label className="block text-sm">📸 ถ่ายรูปสดแก้วที่เสียหายก่อนเททิ้ง
          <input className="mt-1 block text-sm" type="file" accept="image/*" capture="environment" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const body = new FormData();
            body.set("file", file);
            body.set("live_capture", "true");
            body.set("branch_code", props.branch);
            body.set("actor_source", props.actorSource);
            body.set("brand_lock", props.brand);
            void uploadFnbEvidenceAction(body).then((saved) => {
              if (saved.error || !saved.data.url) toast.error(saved.error || "อัปโหลดรูปไม่สำเร็จ");
              else setPhoto(saved.data.url);
            });
          }} />
        </label>
        {photo ? <p className="text-xs text-emerald-700">แนบรูปแล้ว</p> : null}
        <div className="flex gap-2">
          <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={props.onClose}>ปิด</button>
          <button className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">บันทึกทำเมนูผิด</button>
        </div>
      </form>
    </div>
  );
}

export function ShiftIncidentBlock(props: {
  branch: string;
  workDate: string;
  brand: FnbBrandCode;
  actorSource: "desktop" | "liff";
  staffName: string;
  shiftType: "MORNING" | "AFTERNOON";
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
}) {
  const [rows, setRows] = useState<FnbShiftIncidentView>({ remakes: [], writeOffs: [] });
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const label = props.shiftType === "MORNING" ? "กะเช้า" : "กะบ่าย";
  useEffect(() => {
    void listShiftIncidentsAction(props.branch, props.workDate).then((loaded) => {
      if (!loaded.error) setRows(loaded.data);
    });
  }, [props.branch, props.workDate, tick]);
  const remakes = rows.remakes.filter((row) => row.shift === props.shiftType);
  const offs = rows.writeOffs.filter((row) => row.shift === props.shiftType);
  const count = remakes.length + offs.length;
  useEffect(() => { if (count > 0) props.onConfirmed(true); }, [count, props]);
  return (
    <section className="space-y-2 rounded-xl border border-red-200 bg-red-50/40 p-3 text-sm">
      <h3 className="font-semibold">⚠️ รายการทำเมนูผิด / ชงใหม่ และของเสียหายประจำ{label}</h3>
      {count === 0 ? <p className="text-slate-600">ยังไม่มีรายการของ{label}</p> : null}
      {remakes.map((row) => (
        <p key={row.id} className="rounded bg-white px-2 py-1">{row.menu} · {row.qty} แก้ว · {mistakeLabel(row.category)} · {row.staff} <span className="rounded bg-red-50 px-1 font-semibold text-red-600">-{row.cost.toFixed(2)} ฿</span> {row.summary}</p>
      ))}
      {offs.map((row) => (
        <p key={row.id} className="rounded bg-white px-2 py-1">{row.item} · {row.reason} · {row.qty} · {row.staff} <span className="rounded bg-red-50 px-1 font-semibold text-red-600">-{row.cost.toFixed(2)} ฿</span></p>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs" onClick={() => setOpen(true)}>➕ บันทึกทำเมนูผิดเพิ่มของกะนี้</button>
        <WriteOffButton branch={props.branch} workDate={props.workDate} actorSource={props.actorSource} brand={props.brand} staffName={props.staffName} locations={[]} shiftType={props.shiftType} label="➕ บันทึกวัตถุดิบ/ขนมเสียหายของกะนี้" onDone={() => setTick((value) => value + 1)} />
      </div>
      {count === 0 ? (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={props.confirmed} onChange={(event) => props.onConfirmed(event.target.checked)} />
          ยืนยันว่าใน{label}ไม่มีการทำเมนูผิดหรือของเสียหายเพิ่มเติม
        </label>
      ) : null}
      <ShiftDrinkRemakeModal open={open} onClose={() => setOpen(false)} branch={props.branch} workDate={props.workDate} brand={props.brand} actorSource={props.actorSource} staffName={props.staffName} shiftType={props.shiftType} onDone={() => setTick((value) => value + 1)} />
    </section>
  );
}
