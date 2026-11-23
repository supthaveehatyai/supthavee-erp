"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { registerAndVerifyLineWebhookUrlAction } from "@/app/actions/finance/line-oa";
import { getLineSalesBotDiagnosticsAction } from "@/lib/actions/colorway-catalog-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LineSalesBotDiagnostics } from "@/types/line-sales-bot";
import { cn } from "@/lib/utils";

function formatWhen(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("th-TH", { hour12: false });
}

function statusClass(status: string | null): string {
  if (status === "REPLIED_OK") return "bg-emerald-100 text-emerald-800";
  if (status === "REPLIED_FALLBACK") return "bg-amber-100 text-amber-800";
  if (status === "FAILED") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-600";
}

export function LineSalesBotDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [data, setData] = useState<LineSalesBotDiagnostics | null>(null);
  const [endpoint, setEndpoint] = useState("");

  function load() {
    startTransition(async () => {
      const result = await getLineSalesBotDiagnosticsAction();
      setData(result);
      setEndpoint((current) => {
        if (current) return current;
        if (result.recommended_webhook_url) return result.recommended_webhook_url;
        if (result.is_stale_deployment_url) return "";
        return result.line_webhook_url || "";
      });
      if (result.error) toast.error(result.error);
    });
  }

  function openDialog(next: boolean) {
    setOpen(next);
    if (next) load();
  }

  async function syncWebhook() {
    const target = endpoint.trim();
    if (target && !target.startsWith("https://")) {
      toast.error("ใส่ลิงก์ HTTPS ของโดเมน Production");
      return;
    }
    setSyncing(true);
    try {
      const result = await registerAndVerifyLineWebhookUrlAction(target);
      if (!result.success) {
        toast.error(result.error ?? "ซิงก์ Webhook ไม่สำเร็จ");
      } else {
        toast.success(`ลงทะเบียน ${result.endpoint ?? target} แล้ว`);
      }
      const fresh = await getLineSalesBotDiagnosticsAction();
      setData(fresh);
      if (fresh.recommended_webhook_url) setEndpoint(fresh.recommended_webhook_url);
    } finally {
      setSyncing(false);
    }
  }

  const stale = data?.is_stale_deployment_url === true;

  return (
    <>
      <Button type="button" variant="outline" onClick={() => openDialog(true)}>
        🤖 ตั้งค่า & เช็คสถานะ LINE Bot
      </Button>
      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
          <DialogTitle>ตั้งค่า & เช็คสถานะ LINE Bot</DialogTitle>
          <DialogDescription>
            OA {data?.line_oa_basic_id || "@hzr1801v"} — ตรวจว่า LINE ยิงเข้าโดเมน Production ถาวร
            และดู 8 เหตุการณ์ล่าสุดของคำสั่งอย่าง #รูป PS031S
          </DialogDescription>

          {pending && !data ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              กำลังอ่านสถานะจากระบบ
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">Webhook ที่บันทึกอยู่ตอนนี้</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-800">
                    {data?.line_webhook_url || "ยังไม่ได้บันทึก"}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    ตรวจล่าสุด {formatWhen(data?.line_webhook_last_verified_at ?? null)}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs font-medium text-emerald-700">Production ถาวรที่แนะนำ</p>
                  <p className="mt-1 break-all font-mono text-xs text-emerald-900">
                    {data?.recommended_webhook_url || "ยังไม่พบ VERCEL_PROJECT_PRODUCTION_URL"}
                  </p>
                </div>
              </div>

              {stale ? (
                <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-800">
                  LINE กำลังยิงเข้า deployment hash เก่าที่แช่แข็งอยู่ ไม่ใช่โดเมน Production ถาวร
                  ข้อความในกลุ่มจึงไม่ถึงบอทปัจจุบัน กดซิงก์ด้านล่างเพื่อสลับไปที่ลิงก์ถาวรทันที
                </div>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://โดเมน-production/api/line/webhook"
                  aria-label="Webhook endpoint"
                  className="font-mono text-xs"
                />
                <Button type="button" disabled={syncing} onClick={() => void syncWebhook()}>
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : null}
                  🔗 ซิงก์ Webhook ถาวรเข้า LINE OA ทันที
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-800">เหตุการณ์ Webhook ล่าสุด 8 รายการ</p>
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={load}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  รีเฟรช
                </Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">เวลา</th>
                      <th className="px-3 py-2 font-medium">ช่องทาง</th>
                      <th className="px-3 py-2 font-medium">ข้อความ</th>
                      <th className="px-3 py-2 font-medium">สถานะบอท</th>
                      <th className="px-3 py-2 font-medium">รายละเอียด Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.events ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                          ยังไม่มีเหตุการณ์ใน line_webhook_events_log
                        </td>
                      </tr>
                    ) : (
                      data?.events.map((event) => (
                        <tr key={event.id} className="border-t border-slate-100 align-top">
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {formatWhen(event.received_at)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{event.source_type || "-"}</td>
                          <td className="max-w-[16rem] px-3 py-2 break-words text-slate-800">
                            {event.message_text || "-"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 font-medium",
                                statusClass(event.bot_reply_status),
                              )}
                            >
                              {event.bot_reply_status || "-"}
                            </span>
                          </td>
                          <td className="max-w-[18rem] px-3 py-2 break-words text-red-700">
                            {event.bot_reply_error || "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
