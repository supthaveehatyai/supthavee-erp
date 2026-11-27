"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upsertFnbRolePermissionAction } from "@/lib/actions/fnb-people";
import { Switch } from "@/components/ui/switch";
import {
  FNB_GUARDRAIL_PERMISSION_DEFS,
  FNB_MODULE_PERMISSION_DEFS,
  fnbGuardrailPermissionsFrom,
  fnbModulePermissionsFrom,
  type FnbGuardrailPermissionKey,
  type FnbModulePermissionKey,
  type FnbRolePermissionRow,
} from "@/types/fnb";

export function FnbRoleMatrix({ roles, canEdit }: { roles: FnbRolePermissionRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(roles);
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleCode, setRoleCode] = useState("");

  async function persist(next: FnbRolePermissionRow) {
    const saved = await upsertFnbRolePermissionAction({
      roleCode: next.roleCode,
      roleNameTh: next.roleNameTh,
      description: next.description || next.roleNameTh,
      modulePermissions: next.modulePermissions,
      guardrailPermissions: next.guardrailPermissions,
    });
    if (!saved.success) {
      toast.error(saved.error ?? "อัปเดตสิทธิ์ไม่สำเร็จ");
      return false;
    }
    toast.success("อัปเดตสิทธิ์บทบาทเรียบร้อยแล้ว");
    return true;
  }

  async function toggleModule(role: FnbRolePermissionRow, key: FnbModulePermissionKey, enabled: boolean) {
    const token = `${role.roleCode}:${key}`;
    const previous = rows;
    const modulePermissions = { ...role.modulePermissions, [key]: enabled };
    const next = { ...role, modulePermissions };
    setSaving(token);
    setRows(rows.map((item) => item.roleCode === role.roleCode ? next : item));
    const ok = await persist(next);
    if (!ok) setRows(previous);
    setSaving(null);
  }

  async function toggleGuard(role: FnbRolePermissionRow, key: FnbGuardrailPermissionKey, enabled: boolean) {
    const token = `${role.roleCode}:${key}`;
    const previous = rows;
    const guardrailPermissions = { ...role.guardrailPermissions, [key]: enabled };
    const next = { ...role, guardrailPermissions };
    setSaving(token);
    setRows(rows.map((item) => item.roleCode === role.roleCode ? next : item));
    const ok = await persist(next);
    if (!ok) setRows(previous);
    setSaving(null);
  }

  async function createRole() {
    const name = roleName.trim();
    const code = roleCode.trim();
    if (!name || !code) {
      toast.error("กรอกชื่อบทบาทและรหัสบทบาท");
      return;
    }
    setSaving("create");
    const saved = await upsertFnbRolePermissionAction({
      roleCode: code,
      roleNameTh: name,
      description: name,
      modulePermissions: fnbModulePermissionsFrom(null),
      guardrailPermissions: fnbGuardrailPermissionsFrom(null),
    });
    setSaving(null);
    if (!saved.success) {
      toast.error(saved.error ?? "สร้างบทบาทไม่สำเร็จ");
      return;
    }
    toast.success("อัปเดตสิทธิ์บทบาทเรียบร้อยแล้ว");
    setCreating(false);
    setRoleName("");
    setRoleCode("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canEdit ? null : (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          🔒 โหมดอ่านอย่างเดียวสำหรับฝ่ายบุคคล — การเปิด/ปิดสวิตช์ระดับบทบาทสงวนสิทธิ์เฉพาะผู้บริหารสูงสุด (Super Admin)
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">กลุ่มที่ 1: สวิตช์เปิด-ปิดหน้าการทำงาน</h2>
        {canEdit ? (
          <button type="button" className="rounded-xl bg-red-700 px-3 py-2 text-sm font-semibold text-white" disabled={saving === "create"} onClick={() => setCreating((open) => !open)}>
            ➕ สร้างบทบาทใหม่
          </button>
        ) : (
          <button type="button" className="rounded-xl bg-red-700 px-3 py-2 text-sm font-semibold text-white" disabled>➕ สร้างบทบาทใหม่</button>
        )}
      </div>
      {creating && canEdit ? (
        <form className="grid gap-3 rounded-2xl border border-red-200 bg-white p-4 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void createRole(); }}>
          <label className="text-sm">ชื่อบทบาท
            <input className="mt-1 w-full rounded-lg border px-3 py-2" value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder="ผู้จัดการเขต" />
          </label>
          <label className="text-sm">รหัสบทบาท
            <input className="mt-1 w-full rounded-lg border px-3 py-2" value={roleCode} onChange={(event) => setRoleCode(event.target.value)} placeholder="FNB_AREA_MANAGER" />
          </label>
          <button className="self-end rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white" disabled={saving === "create"} type="submit">บันทึกบทบาท</button>
        </form>
      ) : null}
      <Matrix
        rows={rows}
        canEdit={canEdit}
        saving={saving}
        columns={FNB_MODULE_PERMISSION_DEFS}
        read={(role, key) => role.modulePermissions[key as FnbModulePermissionKey]}
        onToggle={(role, key, enabled) => void toggleModule(role, key as FnbModulePermissionKey, enabled)}
      />
      <h2 className="text-lg font-semibold text-slate-900">กลุ่มที่ 2: สวิตช์ควบคุมชั้นความลับราคาทุน / Blind Count / การอนุมัติ</h2>
      <Matrix
        rows={rows}
        canEdit={canEdit}
        saving={saving}
        columns={FNB_GUARDRAIL_PERMISSION_DEFS}
        read={(role, key) => role.guardrailPermissions[key as FnbGuardrailPermissionKey]}
        onToggle={(role, key, enabled) => void toggleGuard(role, key as FnbGuardrailPermissionKey, enabled)}
      />
    </div>
  );
}

function Matrix({
  rows,
  canEdit,
  saving,
  columns,
  read,
  onToggle,
}: {
  rows: FnbRolePermissionRow[];
  canEdit: boolean;
  saving: string | null;
  columns: ReadonlyArray<{ key: string; label: string }>;
  read: (role: FnbRolePermissionRow, key: string) => boolean;
  onToggle: (role: FnbRolePermissionRow, key: string, enabled: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-red-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-red-50 text-slate-700">
          <tr>
            <th className="px-3 py-2">บทบาท</th>
            {columns.map((column) => <th key={column.key} className="min-w-40 px-3 py-2 text-xs font-medium">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((role) => (
            <tr key={role.roleCode} className="border-t">
              <td className="px-3 py-3 align-top">
                <p className="font-medium text-slate-900">{role.roleNameTh}</p>
                <p className="font-mono text-[11px] text-slate-400">{role.roleCode}</p>
              </td>
              {columns.map((column) => {
                const token = `${role.roleCode}:${column.key}`;
                return (
                  <td key={column.key} className="px-3 py-3">
                    <Switch
                      checked={read(role, column.key)}
                      disabled={!canEdit || saving === token}
                      onCheckedChange={(checked) => onToggle(role, column.key, checked)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
