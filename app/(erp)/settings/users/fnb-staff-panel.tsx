"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createFnbStaffAccount,
  resetFnbStaffPin,
  suspendFnbStaffAccount,
  updateFnbStaffAccount,
} from "@/lib/actions/fnb-staff-access";
import type { FnbStaffAccountRow, FnbStaffDraft } from "@/types/holding";

const BRANCHES = {
  LUCKY_CUP: [
    ["LC-HDY", "สาขาหาดใหญ่"],
    ["LC-PSU", "สาขา ม.อ."],
  ],
  CHATORN: [
    ["CT-KLN", "CT-KLN"],
    ["CT-BNP", "CT-BNP"],
    ["CT-NMM", "CT-NMM"],
  ],
} as const;

const emptyDraft = (): FnbStaffDraft => ({
  fullName: "",
  staffNickname: "",
  email: "",
  pin: "",
  brandCode: "LUCKY_CUP",
  workspaceRole: "FNB_STORE_STAFF",
  branchCodes: [],
});

export function FnbStaffPanel({ rows }: { rows: FnbStaffAccountRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FnbStaffDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [pinByUser, setPinByUser] = useState<Record<string, string>>({});
  const branches = BRANCHES[draft.brandCode];
  const editing = Boolean(draft.userId);
  const title = useMemo(
    () => (editing ? "แก้ไขสาขา / ชื่อเล่น" : "สร้างบัญชีพนักงาน Lucky Cup / ร้านน้ำ"),
    [editing],
  );

  function suggestEmail() {
    const slug = draft.staffNickname.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!slug) {
      toast.error("ใส่ชื่อเล่นภาษาอังกฤษก่อนสร้างอีเมลอัตโนมัติ");
      return;
    }
    setDraft((prev) => ({ ...prev, email: `${slug}@luckycup.local` }));
  }

  async function save() {
    setBusy(true);
    const saved = editing ? await updateFnbStaffAccount(draft) : await createFnbStaffAccount(draft);
    setBusy(false);
    if (!saved.success) {
      toast.error(saved.error ?? "บันทึกไม่สำเร็จ");
      return;
    }
    toast.success(editing ? "อัปเดตพนักงานร้านน้ำแล้ว" : "สร้างบัญชีพนักงานร้านน้ำแล้ว");
    setOpen(false);
    setDraft(emptyDraft());
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white"
        onClick={() => {
          setDraft(emptyDraft());
          setOpen(true);
        }}
      >
        ➕ สร้างบัญชีพนักงาน Lucky Cup / ร้านน้ำ
      </button>
      {open ? (
        <div className="rounded-2xl border border-red-200 bg-white p-4 shadow-sm">
          <p className="mb-3 font-semibold text-slate-900">{title}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">ชื่อ-นามสกุลจริง
              <input className="mt-1 w-full rounded-lg border px-3 py-2" value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} />
            </label>
            <label className="text-sm">ชื่อเล่นในร้าน (แสดงบนงานและลายน้ำรูปถ่าย)
              <input className="mt-1 w-full rounded-lg border px-3 py-2" value={draft.staffNickname} onChange={(event) => setDraft({ ...draft, staffNickname: event.target.value })} />
            </label>
            <label className="text-sm">อีเมลสำหรับล็อกอิน
              <span className="mt-1 flex gap-2">
                <input className="w-full rounded-lg border px-3 py-2" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
                <button type="button" className="shrink-0 rounded-lg border px-3 text-xs" onClick={suggestEmail}>อีเมลร้าน</button>
              </span>
            </label>
            {editing ? null : (
              <label className="text-sm">รหัส PIN 6 หลัก
                <input className="mt-1 w-full rounded-lg border px-3 py-2" inputMode="numeric" maxLength={6} value={draft.pin ?? ""} onChange={(event) => setDraft({ ...draft, pin: event.target.value })} />
              </label>
            )}
            <label className="text-sm">แบรนด์ที่สังกัด
              <select className="mt-1 w-full rounded-lg border px-3 py-2" value={draft.brandCode} onChange={(event) => setDraft({ ...draft, brandCode: event.target.value === "CHATORN" ? "CHATORN" : "LUCKY_CUP", branchCodes: [] })}>
                <option value="LUCKY_CUP">🔴 Lucky Cup</option>
                <option value="CHATORN">🟠 ชาทรตะโหมด</option>
              </select>
            </label>
            <label className="text-sm">บทบาท
              <select className="mt-1 w-full rounded-lg border px-3 py-2" value={draft.workspaceRole} onChange={(event) => setDraft({ ...draft, workspaceRole: event.target.value as FnbStaffDraft["workspaceRole"] })}>
                <option value="FNB_STORE_STAFF">พนักงานหน้าร้าน — เข้าได้เฉพาะหน้าส่งงานมือถือ</option>
                <option value="FNB_BRANCH_MANAGER">ผู้จัดการสาขา — ตรวจงานสาขาตัวเองได้</option>
                <option value="FNB_ACCOUNTANT">ฝ่ายบัญชีร้านน้ำ — ชนบิลภาษีและโอนคืนพนักงาน</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {branches.map(([code, label]) => (
              <label key={code} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.branchCodes.includes(code)}
                  onChange={(event) => setDraft({
                    ...draft,
                    branchCodes: event.target.checked
                      ? [...draft.branchCodes, code]
                      : draft.branchCodes.filter((item) => item !== code),
                  })}
                />
                {code} {label}
              </label>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={busy} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={save}>{busy ? "กำลังบันทึก..." : "บันทึก"}</button>
            <button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={() => setOpen(false)}>ปิด</button>
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">พนักงาน</th>
              <th className="px-3 py-2">อีเมล</th>
              <th className="px-3 py-2">สาขา</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-t">
                <td className="px-3 py-2">{row.staffNickname || row.fullName}<div className="text-xs text-slate-500">{row.workspaceRole}</div></td>
                <td className="px-3 py-2">{row.email}</td>
                <td className="px-3 py-2">{row.brandCode} {row.branchCodes.join(", ")}</td>
                <td className="px-3 py-2">{row.isActive ? "ใช้งาน" : "ระงับ"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => { setDraft({ userId: row.userId, fullName: row.fullName, staffNickname: row.staffNickname, email: row.email, brandCode: row.brandCode === "CHATORN" ? "CHATORN" : "LUCKY_CUP", workspaceRole: row.workspaceRole === "FNB_ACCOUNTANT" || row.workspaceRole === "FNB_BRANCH_MANAGER" ? row.workspaceRole : "FNB_STORE_STAFF", branchCodes: row.branchCodes }); setOpen(true); }}>แก้ไขสาขา/ชื่อเล่น</button>
                    <input className="w-24 rounded-lg border px-2 py-1 text-xs" placeholder="PIN ใหม่" value={pinByUser[row.userId] ?? ""} onChange={(event) => setPinByUser({ ...pinByUser, [row.userId]: event.target.value })} />
                    <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={async () => {
                      const saved = await resetFnbStaffPin(row.userId, pinByUser[row.userId] ?? "");
                      if (!saved.success) toast.error(saved.error ?? "รีเซ็ต PIN ไม่สำเร็จ");
                      else toast.success("รีเซ็ต PIN 6 หลักแล้ว");
                    }}>รีเซ็ต PIN 6 หลัก</button>
                    <button type="button" className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700" onClick={async () => {
                      const saved = await suspendFnbStaffAccount(row.userId);
                      if (!saved.success) toast.error(saved.error ?? "ระงับสิทธิ์ไม่สำเร็จ");
                      else {
                        toast.success("ระงับสิทธิ์ทันทีแล้ว");
                        router.refresh();
                      }
                    }}>🚫 ระงับสิทธิ์ทันที (ลาออก)</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
