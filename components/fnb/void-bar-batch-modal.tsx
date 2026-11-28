"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { voidBarWipBatchAction } from "@/lib/actions/fnb-audit";

const REASONS = ["กดปุ่มซ้ำ", "เลือกวัตถุดิบผิดตัว", "กรอกจำนวนผิด"];

export function VoidBarBatchButton(props: {
  batchId: string;
  label: string;
  qtyLabel: string;
  staff: string;
  at: string;
  sourceRefType: string;
  actorName: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const clock = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
  const existing = props.sourceRefType === "EXISTING_ON_BAR";
  return (
    <>
      <button type="button" className="border border-red-300 bg-red-50/70 text-red-700 hover:bg-red-600 hover:text-white text-xs px-2.5 py-1 rounded-md" onClick={() => setOpen(true)}>🚫 ยกเลิกรายการ</button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700">⚠️ ยืนยันการยกเลิกรายการและคืนสต็อกเข้าระบบ</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm">
            <p>{props.label} · {props.qtyLabel}</p>
            <p>ผู้เบิกเดิม {props.staff || "-"} · {props.at || "-"}</p>
            <p className={existing ? "rounded-lg bg-slate-50 p-2" : "rounded-lg bg-amber-50 p-2"}>{existing ? "ℹ️ รายการระบุขวดเปิดค้าง (ไม่ได้ตัดสต็อกคลัง ระบบจะยกเลิกเฉพาะสถานะหน้าบาร์)" : "📦 เมื่อกดยืนยัน ระบบจะทำรายการคืนวัตถุดิบกลับเข้าคลังหลังร้านในบัตรสต็อก (VOID_RETURN_IN) อัตโนมัติ"}</p>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((item) => <button key={item} type="button" className="rounded-full bg-slate-100 px-3 py-1 text-xs" onClick={() => setReason(item)}>{item}</button>)}
            </div>
            <label className="block text-sm">เหตุผลการยกเลิกรายการ *
              <input className="mt-1 h-10 w-full rounded-md border px-3" value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <p className="text-xs text-slate-500">ผู้กดยกเลิก: {props.actorName || "ผู้ตรวจ"} · {clock} น.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>ปิด</AlertDialogCancel>
            <button type="button" className="rounded-md bg-red-600 px-3 py-2 text-sm text-white" disabled={busy} onClick={() => {
              setBusy(true);
              void voidBarWipBatchAction({ batchId: props.batchId, reason }).then((saved) => {
                setBusy(false);
                if (saved.error || !saved.data.ok) toast.error(saved.error || "ยกเลิกรายการไม่สำเร็จ");
                else { toast.success("ยกเลิกรายการและบันทึกประวัติแล้ว"); setOpen(false); props.onDone(); }
              });
            }}>🚨 ยืนยันยกเลิกและคืนสต็อก</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
