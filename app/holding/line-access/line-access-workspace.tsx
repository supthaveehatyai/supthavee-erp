"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { approveLiffRegistrationAction, saveLineChannelAction } from "@/lib/actions/holding-entities";
import { bindLiffSessionAction } from "@/lib/actions/fnb-identity";
import { WORKSPACE_THEMES, type LiffRegistrationRow, type LineChannelRow, type WorkspaceKey } from "@/types/holding";
import { Button } from "@/components/ui/button";

const WORKSPACES: WorkspaceKey[] = ["supthavee", "fnb", "agri", "prop", "holding"];

export function LineAccessWorkspace({
  channels,
  registrations,
  schemaMessage,
  webhookBase,
}: {
  channels: LineChannelRow[];
  registrations: LiffRegistrationRow[];
  schemaMessage: string | null;
  webhookBase: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      {schemaMessage ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{schemaMessage}</div> : null}
      <form
        className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await saveLineChannelAction(formData);
            if (result.error) toast.error(result.error);
            else toast.success("บันทึกช่อง LINE แล้ว");
          });
        }}
      >
        <input name="channel_code" required placeholder="channel_code เช่น fnb" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <select name="workspace_key" className="h-10 rounded border border-slate-200 px-3 text-sm">
          {WORKSPACES.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
        </select>
        <input name="oa_basic_id" placeholder="oa_basic_id" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="liff_id" placeholder="liff_id" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="channel_secret" placeholder="channel_secret" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="channel_access_token" placeholder="channel_access_token" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="default_bank_account_id" placeholder="รหัสบัญชีรับเงินหลัก" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <Button type="submit" disabled={pending}>บันทึกช่อง</Button>
      </form>

      <div className="space-y-3">
        {channels.map((channel) => {
          const webhookUrl = `${webhookBase}/api/line/holding/${channel.channel_code}/webhook`;
          return (
            <article key={channel.channel_code} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-semibold">{channel.channel_code} · {WORKSPACE_THEMES[channel.workspace_key].label}</p>
              <p className="text-slate-500">OA {channel.oa_basic_id ?? "—"} · LIFF {channel.liff_id ?? "—"}</p>
              <p className="mt-2 break-all font-mono text-xs">{webhookUrl}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl);
                  toast.success("คัดลอก Webhook URL แล้ว");
                }}
              >
                คัดลอก Webhook URL
              </Button>
            </article>
          );
        })}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">โหมดจำลองทดสอบ LIFF สำหรับผู้บริหาร</h2>
        <p className="mt-1 text-slate-600">สร้างหรืออนุมัติแถวพนักงานด้วยรหัส LINE ทดสอบ แล้วกดเปิด LIFF ตามแบรนด์ พนักงานจริงยังต้องใช้รหัส LINE ที่อนุมัติและยังไม่ถูกระงับ</p>
      </section>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">คำขอ LIFF</h2>
        {registrations.map((row) => (
          <form
            key={row.id}
            className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await approveLiffRegistrationAction(formData);
                if (result.error) toast.error(result.error);
                else toast.success("อัปเดตสิทธิ์ LIFF แล้ว");
              });
            }}
          >
            <input type="hidden" name="id" value={row.id} />
            <div className="text-sm">
              <p className="font-medium">{row.display_name ?? row.line_user_id}</p>
              <p className="text-xs text-slate-500">{row.channel_code} · {row.status}</p>
            </div>
            <select name="workspace_key" defaultValue={row.workspace_key ?? "holding"} className="h-10 rounded border border-slate-200 px-3 text-sm">
              {WORKSPACES.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
            </select>
            <select name="status" defaultValue={row.status} className="h-10 rounded border border-slate-200 px-3 text-sm">
              <option value="PENDING">PENDING</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
            <select name="assigned_brand_code" defaultValue={row.assigned_brand_code ?? ""} className="h-10 rounded border border-slate-200 px-3 text-sm">
              <option value="">ไม่ระบุแบรนด์</option>
              <option value="LUCKY_CUP">LUCKY_CUP</option>
              <option value="CHATORN">CHATORN</option>
            </select>
            <input name="branch_code" defaultValue={row.branch_code ?? ""} placeholder="สาขาประจำ เช่น LC-HDY" className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <input name="staff_nickname" defaultValue={row.staff_nickname ?? ""} placeholder="ชื่อเล่นพนักงานในร้าน (แสดงบนงานและลายน้ำรูป)" className="h-10 rounded border border-slate-200 px-3 text-sm md:col-span-2" />
            <input type="hidden" name="is_active" value={row.is_active ? "true" : "false"} />
            <Button type="submit" disabled={pending}>{pending ? "กำลังบันทึก..." : "บันทึกสิทธิ์"}</Button>
            <Button
              type="button"
              disabled={pending}
              className={row.is_active ? "bg-red-700 text-white" : "bg-emerald-700 text-white"}
              onClick={() => {
                const body = new FormData();
                body.set("id", row.id);
                body.set("status", row.status === "REVOKED" ? "APPROVED" : row.status);
                body.set("workspace_key", row.workspace_key ?? "fnb");
                body.set("assigned_brand_code", row.assigned_brand_code ?? "");
                body.set("branch_code", row.branch_code ?? "");
                body.set("staff_nickname", row.staff_nickname ?? "");
                body.set("is_active", row.is_active ? "false" : "true");
                startTransition(async () => {
                  const result = await approveLiffRegistrationAction(body);
                  if (result.error) toast.error(result.error);
                  else toast.success(row.is_active ? "ระงับสิทธิ์ทันทีแล้ว" : "เปิดสิทธิ์กลับแล้ว");
                });
              }}
            >
              {row.is_active ? "🚫 ระงับสิทธิ์พนักงานลาออก (Deactivate ทันที)" : "✅ เปิดสิทธิ์กลับ"}
            </Button>
            {row.assigned_brand_code === "LUCKY_CUP" || row.assigned_brand_code === "CHATORN" ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => {
                startTransition(async () => {
                  const bound = await bindLiffSessionAction(row.line_user_id, row.assigned_brand_code === "CHATORN" ? "CHATORN" : "LUCKY_CUP");
                  if (!bound.ok) toast.error(bound.error || "เปิดโหมดทดสอบไม่สำเร็จ");
                  else {
                    toast.success(`พร้อมทดสอบในชื่อ ${bound.name}`);
                    window.location.href = row.assigned_brand_code === "CHATORN" ? "/liff/chatorn" : "/liff/luckycup";
                  }
                });
              }}>เปิด LIFF ทดสอบแบรนด์นี้</Button>
            ) : null}
          </form>
        ))}
      </div>
    </div>
  );
}
