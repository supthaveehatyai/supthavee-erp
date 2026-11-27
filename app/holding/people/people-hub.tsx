"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { provisionCholtiratAction, updateHrDelegationAction } from "@/lib/actions/holding-people";
import type { HoldingPeopleHub, IamDirectoryRow } from "@/types/iam";

const WORKSPACES = ["supthavee", "fnb", "agri", "prop"] as const;

export function PeopleHub({ hub }: { hub: HoldingPeopleHub }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState<"people" | "audit">("people");
  const [selected, setSelected] = useState<IamDirectoryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => hub.people.filter((row) => filter === "all" || row.primaryWorkspace === filter), [hub.people, filter]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-500">HD</p>
        <h1 className="text-2xl font-bold text-slate-900">บุคลากรและสิทธิ์ทั้งเครือ</h1>
      </div>
      {!hub.choltiratLinked ? (
        <button
          type="button"
          className="w-full rounded-2xl bg-red-700 px-4 py-3 text-left text-sm font-semibold text-white"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void provisionCholtiratAction().then((saved) => {
              setBusy(false);
              if (!saved.success) toast.error(saved.error ?? "เปิดใช้งานไม่สำเร็จ");
              else {
                toast.success("เปิดรหัสคุณจวงแล้ว รหัสเริ่มต้น 555555");
                router.refresh();
              }
            });
          }}
        >
          เปิดใช้งานรหัสล็อกอินคุณจวง (Username: choltirat.pan | PIN เริ่มต้น: 555555)
        </button>
      ) : (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">คุณจวงมีรหัส choltirat.pan แล้ว</p>
      )}
      <div className="flex gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "people" ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => setTab("people")}>ทะเบียนทั้งกลุ่ม</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "audit" ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => setTab("audit")}>บันทึก IAM และ PDPA</button>
      </div>
      {tab === "audit" ? (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">เวลา</th><th className="px-3 py-2">การกระทำ</th><th className="px-3 py-2">ผู้ทำ</th><th className="px-3 py-2">เป้าหมาย</th></tr></thead>
            <tbody>
              {hub.audits.map((row) => (
                <tr key={row.id} className="border-t"><td className="px-3 py-2">{row.createdAt.slice(0, 16)}</td><td className="px-3 py-2">{row.actionType}</td><td className="px-3 py-2">{row.actorName}</td><td className="px-3 py-2">{row.targetName}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            {[
              ["all", "ทั้งหมด"],
              ["supthavee", "ทรัพย์ทวี"],
              ["fnb", "เครื่องดื่ม"],
              ["prop", "บ้านเช่า"],
              ["agri", "สวนยาง"],
            ].map(([key, label]) => (
              <button key={key} type="button" className={`rounded-full px-3 py-1 ${filter === key ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">ชื่อ</th><th className="px-3 py-2">Username</th><th className="px-3 py-2">พื้นที่</th><th className="px-3 py-2">PIN</th><th className="px-3 py-2">เข้าล่าสุด</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId} className="border-t">
                    <td className="px-3 py-2">{row.nickname || row.fullName}<div className="text-xs text-slate-500">{row.workspaceRole}{row.isHrManager ? " · HR" : ""}</div></td>
                    <td className="px-3 py-2">{row.username}</td>
                    <td className="px-3 py-2">{row.primaryWorkspace} {row.brandCode ?? ""} {row.branchCodes.join(", ")}</td>
                    <td className="px-3 py-2">{row.mustChangePin ? "รอเปลี่ยนจาก 555555" : "ตั้งรหัสส่วนตัวแล้ว"}</td>
                    <td className="px-3 py-2">
                      {row.lastLoginAt?.slice(0, 16) || "—"}
                      {row.workspaceRole !== "SUPER_ADMIN" ? <button type="button" className="ml-2 text-xs text-blue-700" onClick={() => setSelected(row)}>ตั้งค่าสิทธิ์ HR</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? <HrEditor row={selected} entities={hub.entities} onClose={() => setSelected(null)} /> : null}
        </>
      )}
    </div>
  );
}

function HrEditor({ row, entities, onClose }: { row: IamDirectoryRow; entities: HoldingPeopleHub["entities"]; onClose: () => void }) {
  const router = useRouter();
  const [isHr, setIsHr] = useState(row.isHrManager);
  const [workspaces, setWorkspaces] = useState(row.hrWorkspaces);
  const [entityIds, setEntityIds] = useState(row.hrEntities);
  const [brands, setBrands] = useState(row.hrBrands);
  const [payroll, setPayroll] = useState(row.hrCanPreparePayroll);
  const [privatePay, setPrivatePay] = useState(row.hrCanViewExecPrivatePay);
  const [busy, setBusy] = useState(false);

  function toggle(list: string[], value: string, set: (next: string[]) => void) {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  return (
    <form
      className="space-y-3 rounded-2xl border bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void updateHrDelegationAction({
          userId: row.userId,
          isHrManager: isHr,
          hrWorkspaces: workspaces,
          hrEntities: entityIds,
          hrBrands: brands,
          hrCanPreparePayroll: payroll,
          hrCanViewExecPrivatePay: privatePay,
        }).then((saved) => {
          setBusy(false);
          if (!saved.success) toast.error(saved.error ?? "บันทึกไม่สำเร็จ");
          else {
            toast.success("บันทึกสิทธิ์ HR แล้ว");
            onClose();
            router.refresh();
          }
        });
      }}
    >
      <p className="font-semibold">ตั้งค่าสิทธิ์ HR ประจำบริษัท / แบรนด์ — {row.username || row.fullName}</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isHr} onChange={(event) => setIsHr(event.target.checked)} />แต่งตั้งเป็น HR ประจำสายงาน</label>
      <div className="flex flex-wrap gap-3 text-sm">
        {WORKSPACES.map((item) => <label key={item}><input type="checkbox" checked={workspaces.includes(item)} onChange={() => toggle(workspaces, item, setWorkspaces)} /> {item}</label>)}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {entities.map((item) => <label key={item.id}><input type="checkbox" checked={entityIds.includes(item.id)} onChange={() => toggle(entityIds, item.id, setEntityIds)} /> {item.name}</label>)}
      </div>
      <div className="flex gap-3 text-sm">
        {["LUCKY_CUP", "CHATORN"].map((item) => <label key={item}><input type="checkbox" checked={brands.includes(item)} onChange={() => toggle(brands, item, setBrands)} /> {item === "LUCKY_CUP" ? "Lucky Cup" : "ชาทรตะโหมด"}</label>)}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={payroll} onChange={(event) => setPayroll(event.target.checked)} />อนุญาตเตรียมเงินเดือนพนักงานทั่วไป</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={privatePay} onChange={(event) => setPrivatePay(event.target.checked)} />ดูเงินเดือนผู้บริหารและจ่ายส่วนตัว</label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">บันทึก</button>
        <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={onClose}>ปิด</button>
      </div>
    </form>
  );
}
