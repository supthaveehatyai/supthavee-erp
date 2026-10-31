"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  diagnoseAndSyncLineWebhookAction,
  listLineKnownGroupsAction,
  loadContactLineTargetAction,
  registerAndVerifyLineWebhookUrlAction,
  saveContactLineOaChatUrlAction,
  sendVendorPaymentSlipLineAction,
} from "@/app/actions/finance/line-oa";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  H3_LINE_GROUP_ID,
  LINE_OA_ACCOUNT_UID,
  extractLineTargetId,
  isH3Contact,
  lineBizChatUrl,
} from "@/lib/line/line-target";

type KnownGroup = {
  group_id: string;
  group_name: string | null;
  picture_url: string | null;
  linkedContactId: string | null;
  replyReady: boolean;
  replyExpiresAt: string | null;
};

type LineDiagnosis = Awaited<ReturnType<typeof diagnoseAndSyncLineWebhookAction>>;

function preferredGroupId(groups: KnownGroup[], contactId: string, savedId: string | null): string {
  const linked = groups.find((group) => group.linkedContactId === contactId);
  if (linked) return linked.group_id;
  if (savedId && groups.some((group) => group.group_id === savedId)) return savedId;
  if (groups.length === 1) return groups[0]?.group_id ?? "";
  return "";
}

function apiGroupId(value: string): string {
  const raw = value.trim();
  if (!raw || /chat\.line\.biz/i.test(raw) || raw.includes("/")) return "";
  if (!/^C[A-Za-z0-9]{10,}$/.test(raw)) return "";
  return raw;
}

async function handleCopySlipImageToClipboard(slipUrl: string) {
  const pngBlobPromise = (async () => {
    const proxyUrl = `/api/line/slip-image?url=${encodeURIComponent(slipUrl)}&t=${Date.now()}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error("โหลดไฟล์รูปสลิปไม่สำเร็จ");
    const srcBlob = await res.blob();
    const bitmap = await createImageBitmap(srcBlob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ไม่สามารถสร้าง Canvas Context ได้");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("แปลงเป็น PNG ไม่สำเร็จ"))), "image/png");
    });
  })();

  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlobPromise })]);
}

async function slipJpegBase64(slipUrl: string): Promise<string> {
  const proxyUrl = `/api/line/slip-image?url=${encodeURIComponent(slipUrl)}&t=${Date.now()}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error("โหลดไฟล์รูปสลิปไม่สำเร็จ");
  const srcBlob = await res.blob();
  const bitmap = await createImageBitmap(srcBlob);
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ไม่สามารถสร้าง Canvas Context ได้");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  return dataUrl.replace(/^data:image\/jpeg;base64,/i, "");
}

export type LinePaymentSlipDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  billingNoteNo?: string | null;
  paymentDocNo?: string | null;
  messageText: string;
  slipUrl?: string | null;
  onSent?: () => void;
};

export function LinePaymentSlipDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  billingNoteNo,
  paymentDocNo,
  messageText,
  slipUrl,
  onSent,
}: LinePaymentSlipDialogProps) {
  const [groups, setGroups] = useState<KnownGroup[]>([]);
  const [oaUid, setOaUid] = useState(LINE_OA_ACCOUNT_UID);
  const [targetId, setTargetId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [draft, setDraft] = useState(messageText);
  const [manualGroupId, setManualGroupId] = useState("");
  const [sending, setSending] = useState(false);
  const [copyingSlip, setCopyingSlip] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<LineDiagnosis | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerNote, setRegisterNote] = useState<string | null>(null);
  const [registerOk, setRegisterOk] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(messageText);
    let cancelled = false;
    void Promise.all([
      listLineKnownGroupsAction(),
      loadContactLineTargetAction(contactId, contactName),
    ]).then(([listed, saved]) => {
      if (cancelled) return;
      setGroups(listed.groups);
      const accountUid = listed.oaAccountUid || LINE_OA_ACCOUNT_UID;
      if (listed.oaAccountUid) setOaUid(listed.oaAccountUid);
      setTargetId(preferredGroupId(listed.groups, contactId, saved.lineTargetId));
      const savedChat = saved.lineOaChatUrl?.trim() || "";
      setChatInput(
        savedChat || (isH3Contact(contactName) ? lineBizChatUrl(accountUid, H3_LINE_GROUP_ID) : ""),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, contactId, contactName, messageText]);

  const webhookGroupId = groups.some((group) => group.group_id === targetId) ? targetId : "";
  const manualTrimmed = manualGroupId.trim();
  const pastedGroupId = apiGroupId(manualGroupId);
  const sendGroupId = webhookGroupId || pastedGroupId;
  const activeGroup = groups.find((group) => group.group_id === sendGroupId);

  async function sendNow() {
    if (!webhookGroupId && manualTrimmed && !pastedGroupId) {
      toast.error("API Group ID ต้องขึ้นต้นด้วย C และห้ามวางลิงก์ chat.line.biz ในช่องนี้");
      return;
    }
    if (!sendGroupId) {
      toast.error("เลือกกลุ่มจาก Dropdown ก่อน — รหัสในลิงก์ chat.line.biz ใช้ส่ง Push ไม่ได้");
      return;
    }
    setSending(true);
    let jpegBase64 = "";
    if (slipUrl?.startsWith("https://")) {
      try {
        jpegBase64 = await slipJpegBase64(slipUrl);
      } catch (error) {
        console.error(error);
        setSending(false);
        toast.error("เตรียมรูปสลิปสำหรับ LINE ไม่สำเร็จ");
        return;
      }
    }
    const result = await sendVendorPaymentSlipLineAction({
      contactId,
      contactName,
      lineTargetId: sendGroupId,
      messageText: draft,
      slipPublicUrl: slipUrl,
      jpegBase64,
      billingNoteNo,
      paymentDocNo,
    });
    setSending(false);
    if (!result.success) {
      toast.error(result.error ?? "ส่งเข้า LINE ไม่สำเร็จ");
      return;
    }
    const via = result.channel === "reply" ? "Reply API (ไม่เสียโควตา)" : "Push API";
    if (slipUrl?.startsWith("https://") && !result.imageSent) {
      toast.success(`ส่งข้อความผ่าน ${via} แล้ว — LINE รับรูปไม่ได้ ระบบส่งเฉพาะข้อความให้แล้ว`);
    } else {
      toast.success(`ส่งข้อความและรูปสลิปผ่าน ${via} แล้ว`);
    }
    onSent?.();
    onOpenChange(false);
  }

  async function registerWebhook() {
    setRegistering(true);
    const result = await registerAndVerifyLineWebhookUrlAction(`${window.location.origin}/api/line/webhook`);
    setRegistering(false);
    setGroups(result.groups);
    setTargetId((current) =>
      result.groups.some((group) => group.group_id === current)
        ? current
        : preferredGroupId(result.groups, contactId, current),
    );
    const connected = result.statusCode === 200 && result.active === true;
    setRegisterOk(connected);
    const refreshLine = `รีเฟรชรายชื่อกลุ่มใน Dropdown แล้ว ${result.groups.length} กลุ่ม`;
    const note = connected
      ? `✅ เชื่อมต่อ LINE Webhook สำเร็จ! (ให้ส่งสติกเกอร์หรือพิมพ์ 1 ข้อความในกลุ่มคู่ค้าเพื่อดึงชื่อกลุ่มเข้ามาในรายการ) ${refreshLine}`
      : `${result.error ?? "ยังเชื่อมต่อ LINE Webhook ไม่สำเร็จ"} ${refreshLine}`;
    setRegisterNote(note);
    if (connected) toast.success("เชื่อมต่อ LINE Webhook สำเร็จ");
    else toast.error(result.error ?? "ยังเชื่อมต่อ LINE Webhook ไม่สำเร็จ");
  }

  async function diagnoseWebhook() {
    setDiagnosing(true);
    const result = await diagnoseAndSyncLineWebhookAction(window.location.origin);
    setDiagnosing(false);
    setDiagnosis(result);
    setGroups(result.groups);
    if (result.error) toast.error(result.error);
    else toast.success("ตรวจสอบสัญญาณ Webhook และรีเฟรชรายชื่อกลุ่มแล้ว");
  }

  async function copyAndOpenChat() {
    const typed = chatInput.trim();
    const extracted = extractLineTargetId(typed);
    const openUrl = typed.startsWith("http")
      ? typed
      : extracted
        ? lineBizChatUrl(oaUid, extracted)
        : isH3Contact(contactName)
          ? lineBizChatUrl(oaUid, H3_LINE_GROUP_ID)
          : "";
    if (!openUrl.includes("chat.line.biz")) {
      toast.error("กรุณาวางลิงก์ห้องแชทจากหน้า chat.line.biz");
      return;
    }
    if (contactId) {
      try {
        await saveContactLineOaChatUrlAction(contactId, openUrl);
      } catch (err) {
        console.error(err);
      }
    }
    try {
      await navigator.clipboard.writeText(draft);
      toast.success("✅ คัดลอกข้อความแล้ว! กด Ctrl+V วางในช่องแชท LINE OA และส่งรูปสลิปได้เลย");
    } catch {
      toast.error("คัดลอกข้อความไม่สำเร็จ");
    }
    window.open(openUrl, "_blank", "noopener,noreferrer");
  }

  async function copySlipImage() {
    if (!slipUrl?.startsWith("https://")) return;
    setCopyingSlip(true);
    try {
      await handleCopySlipImageToClipboard(slipUrl);
      toast.success("✅ คัดลอกรูปสลิปลง Clipboard เรียบร้อยแล้ว! (กด Ctrl+V วางในแชท LINE ได้เลย)");
    } catch (error) {
      console.error(error);
      toast.error("คัดลอกรูปสลิปไม่สำเร็จ");
    } finally {
      setCopyingSlip(false);
    }
  }

  function downloadSlip() {
    if (!slipUrl?.startsWith("https://")) return;
    const link = document.createElement("a");
    link.href = `/api/line/slip-image?url=${encodeURIComponent(slipUrl)}&download=1`;
    link.download = "payment-slip.jpg";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ส่งสลิปโอนเงินแจ้งคู่ค้าผ่าน LINE OA (@hzr1801v)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="line-chat-url">ลิงก์ห้องแชท LINE OA (จากหน้า chat.line.biz)</Label>
            <Input
              id="line-chat-url"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="https://chat.line.biz/.../chat/C..."
            />
          </div>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => void copyAndOpenChat()}
            >
              💬 คัดลอกข้อความแจ้งโอน + เปิดห้องแชท LINE OA (chat.line.biz) ทันที
            </Button>
            {groups.length > 0 ? (
              <Button
                type="button"
                className="bg-blue-600 text-white hover:bg-blue-700"
                disabled={sending || !sendGroupId}
                onClick={() => void sendNow()}
              >
                {sending ? "กำลังส่ง..." : "🚀 ยิงข้อความ + รูปสลิปเข้ากลุ่มผ่าน LINE OA API ทันที"}
              </Button>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="line-message">ข้อความแจ้งโอนเงิน</Label>
            <textarea
              id="line-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={8}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          {slipUrl?.startsWith("https://") ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-700">รูปสลิปโอนเงิน</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-2.5 text-xs"
                    disabled={copyingSlip}
                    onClick={() => void copySlipImage()}
                  >
                    {copyingSlip ? "กำลังคัดลอกรูป..." : "🖼️ คัดลอกรูปสลิปลง Clipboard"}
                  </Button>
                  <Button type="button" variant="outline" className="h-8 px-2.5 text-xs" onClick={downloadSlip}>
                    ⬇️ ดาวน์โหลดรูปสลิป
                  </Button>
                </div>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slipUrl} alt="สลิปโอนเงิน" className="max-h-48 rounded-lg border object-contain" />
            </div>
          ) : (
            <p className="text-xs text-slate-500">ไม่มีรูปสลิปแบบลิงก์สาธารณะ จะส่งเฉพาะข้อความ</p>
          )}
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs leading-5 text-slate-600">
              ส่งผ่าน LINE Push API ใช้ได้เมื่อได้ API Group ID จาก Webhook แล้วเท่านั้น
              รหัสหลัง /chat/ ของ chat.line.biz เป็นคนละรหัสกับ groupId จึงใช้ยิง Push ไม่ได้
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                id="line-group"
                value={webhookGroupId}
                onChange={(event) => setTargetId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">เลือก API Group ID จาก Webhook ({groups.length} กลุ่ม)</option>
                {groups.map((group) => (
                  <option key={group.group_id} value={group.group_id}>
                    {group.group_name || group.group_id}
                    {group.replyReady ? " · Reply พร้อม" : ""}
                  </option>
                ))}
              </select>
              <Input
                id="line-group-manual"
                value={manualGroupId}
                onChange={(event) => setManualGroupId(event.target.value)}
                placeholder="หรือวาง API Group ID (C...)"
              />
            </div>
            <p className="text-xs text-slate-500">
              {activeGroup?.replyReady
                ? "กลุ่มนี้มี reply token ที่ยังไม่หมดอายุ ระบบจะส่งผ่าน Reply API ก่อน (ฟรี) แล้วจึง Push หากส่งไม่ได้"
                : "ถ้าไม่มี reply token ที่ยังไม่หมดอายุ ระบบจะส่งผ่าน Push API"}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={sending || !sendGroupId}
              onClick={() => void sendNow()}
            >
              {sending
                ? "กำลังส่ง..."
                : activeGroup?.replyReady
                  ? "ส่งผ่าน Reply API ก่อน (ฟรี) แล้วสำรอง Push"
                  : "ส่งข้อความ 4 บรรทัด + รูปสลิปผ่าน LINE OA Push API"}
            </Button>
          </div>
          <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
            <p className="text-sm font-medium text-slate-800">📡 สถานะการเชื่อมต่อ LINE OA Push API & Webhook</p>
            <Button
              type="button"
              className="h-8 bg-amber-500 px-2.5 text-xs text-white hover:bg-amber-600"
              disabled={registering}
              onClick={() => void registerWebhook()}
            >
              {registering ? "กำลังซิงก์..." : "🔄 ซิงก์ Webhook & รีเฟรชรายชื่อกลุ่ม LINE"}
            </Button>
            {registerNote ? (
              <p className={registerOk ? "text-sm font-medium text-emerald-700" : "text-xs text-amber-800"}>{registerNote}</p>
            ) : null}
            <Button type="button" variant="outline" className="h-8 bg-white px-2.5 text-xs" disabled={diagnosing} onClick={() => void diagnoseWebhook()}>
              {diagnosing ? "กำลังตรวจสอบ..." : "🔍 ตรวจสอบ/ทดสอบสัญญาณ Webhook & รีเฟรชรายชื่อกลุ่ม"}
            </Button>
            {diagnosis ? <LineWebhookStatus diagnosis={diagnosis} /> : (
              <p className="text-xs text-slate-500">ยังไม่ได้ตรวจสอบในรอบนี้</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LineWebhookStatus({ diagnosis }: { diagnosis: LineDiagnosis }) {
  const active = diagnosis.webhook.active;
  const statusCode = diagnosis.test.statusCode;
  const testLocked = statusCode === 401 || statusCode === 403;
  const testOk = diagnosis.test.success === true || statusCode === 200;
  const used = diagnosis.quota.used;
  const limit = diagnosis.quota.limit;
  const quotaText =
    used == null
      ? diagnosis.quota.error ?? "ยังอ่านโควตาไม่ได้"
      : `ใช้ไป ${used.toLocaleString("th-TH")} / ${limit == null ? "ไม่จำกัด" : limit.toLocaleString("th-TH")} ข้อความ`;

  return (
    <div className="space-y-1 text-xs leading-5 text-slate-700">
      <p>
        <span className="font-medium">สวิตช์ Webhook บน LINE OA: </span>
        {active === true
          ? "🟢 เปิดใช้งานแล้ว"
          : active === false
            ? "🔴 ปิดอยู่ (กรุณาไปที่หน้า LINE OA -> ตั้งค่าการตอบกลับ -> เปิดสวิตช์ Webhook)"
            : diagnosis.webhook.error ?? "ยังอ่านสถานะสวิตช์ไม่ได้"}
      </p>
      <p>
        <span className="font-medium">ผลการยิงทดสอบจาก LINE Server: </span>
        {testOk
          ? "🟢 เชื่อมต่อสำเร็จ (HTTP 200)"
          : testLocked
            ? `🟠 ติดล็อก Vercel Preview (HTTP ${statusCode}) — แนะนำให้ปิด Vercel Authentication ในหน้า Settings -> Deployment Protection ของ Vercel`
            : (diagnosis.test.error ??
              ([diagnosis.test.reason, diagnosis.test.detail].filter(Boolean).join(" — ") ||
                "ยังไม่มีผลทดสอบ"))}
      </p>
      <p>
        <span className="font-medium">โควตาข้อความ Push API เดือนนี้: </span>
        {quotaText}
      </p>
      {diagnosis.webhook.endpoint ? (
        <p className="text-slate-500">
          Endpoint ที่ LINE ยิง: {diagnosis.webhook.endpoint}
          {diagnosis.currentOrigin && !diagnosis.webhook.endpoint.startsWith(diagnosis.currentOrigin)
            ? ` (หน้านี้คือ ${diagnosis.currentOrigin})`
            : ""}
        </p>
      ) : null}
      {diagnosis.recentEvents.length > 0 ? (
        <ul className="list-disc pl-4 text-slate-500">
          {diagnosis.recentEvents.map((event, index) => (
            <li key={`${event.received_at}-${index}`}>
              {event.event_type}
              {event.source_group_id ? ` · ${event.source_group_id}` : ""}
              {event.message_text ? ` · ${event.message_text}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500">ยังไม่มีเหตุการณ์ใน line_webhook_events_log</p>
      )}
    </div>
  );
}
