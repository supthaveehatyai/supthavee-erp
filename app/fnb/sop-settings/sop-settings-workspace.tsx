"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { listParLevelsAction, saveBranchShiftSettingsAction, saveParLevelAction, saveSopTemplateAction, toggleSopAssignmentAction } from "@/lib/actions/fnb-sop";
import { BranchPlaceManager } from "@/components/fnb/branch-place-manager";
import { FNB_BRANCH_CODES, FNB_SOP_INPUT_TYPES, type FnbBranchOption, type FnbParLevelRow, type FnbSopTemplate } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";
const STAGE_LABEL = { OPENING: "1. เปิดร้าน (กะแรก)", SHIFT_HANDOVER: "2. ส่งมอบระหว่างกะ (กะแรก / กะสอง / กะสาม)", CLOSING: "3. ปิดร้าน (กะสุดท้ายของวัน)" };

export function SopSettingsWorkspace({
  branches,
  templates,
  items,
  schemaMessage,
}: {
  branches: FnbBranchOption[];
  templates: FnbSopTemplate[];
  items: { id: string; short_code: string; name_th: string }[];
  schemaMessage: string | null;
}) {
  const [parBranch, setParBranch] = useState(branches[0]?.branch_code ?? "LC-HDY");
  const [pars, setPars] = useState<FnbParLevelRow[]>([]);
  const [message, setMessage] = useState(schemaMessage ?? "");
  const [, start] = useTransition();

  function run(task: () => Promise<{ error: string | null }>, success: string) {
    start(async () => {
      const saved = await task();
      if (saved.error) {
        toast.error(saved.error);
        setMessage(saved.error);
        return;
      }
      toast.success(success);
      setMessage(success);
    });
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">ตั้งค่าระเบียบหน้าร้านและกะสาขา</h1>
      <Link href="/fnb/items?tab=shelf" className="inline-block rounded-md bg-red-700 px-3 py-2 text-sm text-white">อายุวัตถุดิบหลังเปิดใช้ / หลังผสม (แยกแบรนด์)</Link>
      {message ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}
      <BranchPlaceManager branches={branches.map((branch) => ({ branch_code: branch.branch_code, branch_name_th: branch.branch_name_th }))} />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">วงเงินทอนประจำเก๊ะและเวลาเปิดปิด</h2>
        {branches.map((branch) => (
          <form key={branch.branch_code} className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-4" onSubmit={(event) => {
            event.preventDefault();
            const body = new FormData(event.currentTarget);
            run(() => saveBranchShiftSettingsAction(body), `บันทึก ${branch.branch_code} แล้ว`);
          }}>
            <input type="hidden" name="branch_code" value={branch.branch_code} />
            <p className="font-semibold md:col-span-4">{branch.branch_code} {branch.branch_name_th}</p>
            <label className="text-sm">วงเงินทอนตั้งต้นในเก๊ะ (บาท)<input className={field} name="standard_cash_float" type="number" step="0.01" defaultValue={branch.standard_cash_float} /></label>
            <label className="text-sm">เปิด<input className={field} name="opening_time" type="time" defaultValue={clock(branch.opening_time)} /></label>
            <label className="text-sm">ปิด<input className={field} name="closing_time" type="time" defaultValue={clock(branch.closing_time)} /></label>
            <label className="text-sm">เส้นตายส่งงานเปิดร้าน<input className={field} name="opening_deadline_time" type="time" defaultValue={clock(branch.opening_deadline_time)} /></label>
            <label className="text-sm">กะแรกเริ่ม<input className={field} name="shift_1_start" type="time" defaultValue={clock(branch.shift_1_start)} /></label>
            <label className="text-sm">กะแรกจบ<input className={field} name="shift_1_end" type="time" defaultValue={clock(branch.shift_1_end)} /></label>
            <label className="text-sm">กะสองเริ่ม<input className={field} name="shift_2_start" type="time" defaultValue={clock(branch.shift_2_start)} /></label>
            <label className="text-sm">กะสองจบ<input className={field} name="shift_2_end" type="time" defaultValue={clock(branch.shift_2_end)} /></label>
            <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" name="enable_shift_3" value="true" defaultChecked={branch.enable_shift_3} /> 🌙 เปิดใช้งาน กะสาม (รอบดึก/เทศกาล)</label>
            <label className="text-sm">กะสามเริ่ม<input className={field} name="shift_3_start" type="time" defaultValue={clock(branch.shift_3_start)} /></label>
            <label className="text-sm">กะสามจบ<input className={field} name="shift_3_end" type="time" defaultValue={clock(branch.shift_3_end)} /></label>
            <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white">บันทึกสาขา</button>
          </form>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">คลังระเบียบกลางและตาราง 5 สาขา</h2>
        <TemplateForm items={items} onSave={(body) => run(() => saveSopTemplateAction(body), "บันทึกหัวข้อแล้ว")} />
        {(["OPENING", "SHIFT_HANDOVER", "CLOSING"] as const).map((stage) => (
          <div key={stage} className="space-y-2">
            <h3 className="font-semibold">{STAGE_LABEL[stage]}</h3>
            {templates.filter((row) => row.stage_code === stage).map((row) => (
              <article key={row.id} className="rounded-xl border bg-white p-3 text-sm">
                <p className="font-medium">{row.title_th} · {row.input_type} · {row.schedule_type} {row.is_active ? "" : "(ปิดใช้)"}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {FNB_BRANCH_CODES.map((code) => (
                    <label key={code} className="flex items-center gap-1">
                      <input type="checkbox" defaultChecked={row.branches.includes(code)} onChange={(event) => {
                        void toggleSopAssignmentAction(row.id, code, event.target.checked).then((saved) => {
                          if (saved.error) toast.error(saved.error);
                          else toast.success(`${code} ${event.target.checked ? "เปิด" : "ปิด"} ${row.title_th}`);
                        });
                      }} />
                      {code}
                    </label>
                  ))}
                </div>
                <TemplateForm items={items} template={row} onSave={(body) => run(() => saveSopTemplateAction(body), "แก้ไขหัวข้อแล้ว")} />
              </article>
            ))}
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">จุดเตือนของใกล้หมดรายสาขา</h2>
        <select className={field} value={parBranch} onChange={(event) => {
          setParBranch(event.target.value);
          void listParLevelsAction(event.target.value).then((listed) => setPars(listed.data));
        }}>
          {branches.map((branch) => <option key={branch.branch_code} value={branch.branch_code}>{branch.branch_code}</option>)}
        </select>
        <button type="button" className="text-sm text-red-700" onClick={() => void listParLevelsAction(parBranch).then((listed) => setPars(listed.data))}>โหลดจุดเตือน</button>
        {pars.map((row) => <p key={row.item_id} className="text-sm">{row.short_code} {row.name_th} จุดต่ำสุด {row.min_par_count_qty} สั่งล่วงหน้า {row.lead_time_days} วัน {row.is_below_par ? "ต่ำกว่าจุดสั่ง" : ""}</p>)}
        <form className="grid gap-2 md:grid-cols-4" onSubmit={(event) => {
          event.preventDefault();
          run(() => saveParLevelAction(new FormData(event.currentTarget)), "บันทึกจุดเตือนแล้ว");
        }}>
          <input type="hidden" name="branch_code" value={parBranch} />
          <select className={field} name="item_id">{items.map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}</select>
          <input className={field} name="min_par_count_qty" type="number" step="0.01" placeholder="จุดเตือนขั้นต่ำ" />
          <input className={field} name="lead_time_days" type="number" placeholder="สั่งล่วงหน้า (วัน)" defaultValue={2} />
          <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white">บันทึกจุดเตือน</button>
        </form>
      </section>
    </div>
  );
}

function TemplateForm({
  items,
  template,
  onSave,
}: {
  items: { id: string; short_code: string; name_th: string }[];
  template?: FnbSopTemplate;
  onSave: (body: FormData) => void;
}) {
  const [open, setOpen] = useState(!template);
  if (!open) return <button type="button" className="mt-2 text-sm text-red-700" onClick={() => setOpen(true)}>{template ? "แก้ไขหัวข้อ" : "สร้างหัวข้อใหม่"}</button>;
  return (
    <form className="mt-3 grid gap-2 md:grid-cols-3" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      body.set("live_camera_only", body.get("live_camera_only") ? "true" : "false");
      body.set("is_mandatory", body.get("is_mandatory") ? "true" : "false");
      body.set("is_active", body.get("is_active") ? "true" : "false");
      onSave(body);
    }}>
      <input type="hidden" name="id" value={template?.id ?? ""} />
      <input className={field} name="title_th" placeholder="ชื่อหัวข้องาน" defaultValue={template?.title_th ?? ""} required />
      <select className={field} name="stage_code" defaultValue={template?.stage_code ?? "OPENING"}>
        <option value="OPENING">เปิดร้าน</option>
        <option value="SHIFT_HANDOVER">ส่งมอบกะ</option>
        <option value="CLOSING">ปิดร้าน</option>
      </select>
      <select className={field} name="brand_scope" defaultValue={template?.brand_scope ?? "ALL"}>
        <option value="ALL">ทุกแบรนด์</option>
        <option value="LUCKY_CUP">Lucky Cup</option>
        <option value="CHATORN">ชาทรตะโหมด</option>
      </select>
      <textarea className="rounded-md border px-3 py-2 text-sm md:col-span-3" name="description_instruction" placeholder="คำอธิบายวิธีทำ" defaultValue={template?.description_instruction ?? ""} />
      <select className={field} name="input_type" defaultValue={template?.input_type ?? "PHOTO_ONLY"}>
        {FNB_SOP_INPUT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <select className={field} name="linked_item_id" defaultValue={template?.linked_item_id ?? ""}>
        <option value="">ไม่ผูกวัตถุดิบ</option>
        {items.map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}
      </select>
      <select className={field} name="schedule_type" defaultValue={template?.schedule_type ?? "DAILY"}>
        <option value="DAILY">ทุกวัน</option>
        <option value="WEEKLY_DAYS">เลือกวันในสัปดาห์</option>
        <option value="MONTHLY_DATES">เลือกวันที่ในเดือน</option>
      </select>
      <input className={field} name="schedule_days" placeholder="วัน เช่น 1,3,5 (จ=1 อา=7) หรือวันที่ 1,15" defaultValue={template?.schedule_days.join(",") ?? ""} />
      <input className={field} name="sort_order" type="number" placeholder="ลำดับ" defaultValue={template?.sort_order ?? 100} />
      <label className="text-sm">รูปตัวอย่าง<input className="mt-1 block" name="reference_photo" type="file" accept="image/*" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="live_camera_only" defaultChecked={template?.live_camera_only ?? true} /> บังคับถ่ายกล้องสดเท่านั้น</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_mandatory" defaultChecked={template?.is_mandatory ?? true} /> บังคับส่งก่อนปิดเช็คลิสต์</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={template?.is_active ?? true} /> เปิดใช้งาน</label>
      <button className="rounded-md bg-red-700 px-3 py-2 text-sm text-white">{template ? "บันทึกการแก้ไข" : "สร้างหัวข้อ"}</button>
    </form>
  );
}

function clock(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}
