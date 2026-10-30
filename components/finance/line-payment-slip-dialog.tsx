"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  listLineKnownGroupsAction,
  loadContactLineTargetAction,
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
  H3_LINE_GROUP_NAME,
  LINE_OA_ACCOUNT_UID,
  extractLineTargetId,
  isH3Contact,
  lineBizChatUrl,
} from "@/lib/line/line-target";

type KnownGroup = {
  group_id: string;
  group_name: string | null;
  picture_url: string | null;
};

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
  const [sending, setSending] = useState(false);

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
      if (listed.oaAccountUid) setOaUid(listed.oaAccountUid);
      const initial = saved.lineTargetId || (isH3Contact(contactName) ? H3_LINE_GROUP_ID : "");
      setTargetId(initial);
      setChatInput(initial ? lineBizChatUrl(listed.oaAccountUid || LINE_OA_ACCOUNT_UID, initial) : "");
    });
    return () => {
      cancelled = true;
    };
  }, [open, contactId, contactName, messageText]);

  const options = groups.some((group) => group.group_id === H3_LINE_GROUP_ID)
    ? groups
    : [{ group_id: H3_LINE_GROUP_ID, group_name: H3_LINE_GROUP_NAME, picture_url: null }, ...groups];
  const resolvedId = extractLineTargetId(chatInput) || extractLineTargetId(targetId) || "";

  async function sendNow() {
    if (!resolvedId) {
      toast.error("กรุณาเลือกกลุ่ม หรือวางลิงก์ห้องแชท");
      return;
    }
    setSending(true);
    const result = await sendVendorPaymentSlipLineAction({
      contactId,
      contactName,
      lineOaChatUrl: chatInput,
      lineTargetId: resolvedId,
      messageText: draft,
      slipPublicUrl: slipUrl,
      billingNoteNo,
      paymentDocNo,
    });
    setSending(false);
    if (!result.success) {
      toast.error(result.error ?? "ส่งเข้า LINE ไม่สำเร็จ");
      return;
    }
    toast.success("ส่งข้อความและรูปสลิปเข้ากลุ่ม LINE แล้ว");
    onSent?.();
    onOpenChange(false);
  }

  async function copyAndOpenChat() {
    if (!resolvedId) {
      toast.error("กรุณาเลือกกลุ่ม หรือวางลิงก์ห้องแชท");
      return;
    }
    try {
      await navigator.clipboard.writeText(draft);
      toast.success("คัดลอกข้อความแจ้งโอนแล้ว");
    } catch {
      toast.error("คัดลอกข้อความไม่สำเร็จ");
    }
    window.open(lineBizChatUrl(oaUid, resolvedId), "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ส่งสลิปโอนเงินแจ้งคู่ค้าผ่าน LINE OA (@hzr1801v)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="line-group">กลุ่ม LINE</Label>
            <select
              id="line-group"
              value={targetId}
              onChange={(event) => {
                const next = event.target.value;
                setTargetId(next);
                if (next) setChatInput(lineBizChatUrl(oaUid, next));
              }}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">เลือกกลุ่มที่บอทรู้จัก</option>
              {options.map((group) => (
                <option key={group.group_id} value={group.group_id}>
                  {group.group_id === H3_LINE_GROUP_ID
                    ? H3_LINE_GROUP_NAME
                    : group.group_name || group.group_id}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="line-chat-url">ลิงก์ห้องแชท LINE OA (จากหน้า chat.line.biz) / Group ID</Label>
            <Input
              id="line-chat-url"
              value={chatInput}
              onChange={(event) => {
                const next = event.target.value;
                setChatInput(next);
                const extracted = extractLineTargetId(next);
                if (extracted) setTargetId(extracted);
              }}
              placeholder="https://chat.line.biz/.../chat/C..."
            />
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
              <p className="text-sm font-medium text-slate-700">รูปสลิปโอนเงิน</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slipUrl} alt="สลิปโอนเงิน" className="max-h-48 rounded-lg border object-contain" />
            </div>
          ) : (
            <p className="text-xs text-slate-500">ไม่มีรูปสลิปแบบลิงก์สาธารณะ จะส่งเฉพาะข้อความ</p>
          )}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={sending}
              onClick={() => void sendNow()}
            >
              {sending ? "กำลังส่ง..." : "🚀 ส่งข้อความ + รูปสลิปเข้ากลุ่มทันที (LINE OA Push API)"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void copyAndOpenChat()}>
              💬 คัดลอกข้อความ + เปิดห้องแชท LINE OA (chat.line.biz)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
