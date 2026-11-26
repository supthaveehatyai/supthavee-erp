"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reviewShiftChangeAction } from "@/lib/actions/fnb-operations";
import type { FnbChangeRequestRow } from "@/types/fnb";

const MONEY_KEYS = [
  ["gross_sales", "ยอดขาย"],
  ["discount_total", "ส่วนลด"],
  ["net_sales_inc_vat", "ยอดสุทธิ"],
  ["cash_pos_amount", "เงินสด POS"],
  ["cash_counted_amount", "เงินสดนับจริง"],
  ["qr_amount", "QR"],
  ["lineman_gross_amount", "LineMan"],
  ["grab_gross_amount", "Grab"],
  ["webapp_amount", "เว็บแอป"],
  ["deposit_method", "วิธีฝากเงิน"],
  ["bank_deposit_amount", "ยอดฝากธนาคาร"],
  ["seven_eleven_deposit_amount", "ยอดฝาก 7-Eleven"],
] as const;

export function ApprovalQueue({ requests, onDone }: { requests: FnbChangeRequestRow[]; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  if (requests.length === 0) return null;
  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold text-amber-950">คิวอนุมัติแก้ไขตัวเลขการเงิน</h2>
      {requests.map((request) => (
        <article key={request.id} className="rounded-lg bg-white p-3 text-sm">
          <p className="font-semibold">{request.request_no} · {request.branch_code} · {request.shift_type === "MORNING" ? "กะเช้า" : "กะบ่าย"} · {request.work_date}</p>
          <p>ผู้ขอ {request.requested_by_name} · สาเหตุ {request.edit_reason}</p>
          <div className="mt-2 grid gap-1 md:grid-cols-2">
            {MONEY_KEYS.map(([key, label]) => (
              <p key={key}>{label}: ยอดเดิม {String(request.old_payload[key] ?? "-")} → ยอดที่ขอแก้ {String(request.proposed_payload[key] ?? "-")}</p>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending} className="rounded-md bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-60" onClick={() => decide(request.id, "APPROVED")}>
              {busyId === request.id ? "กำลังบันทึก..." : "อนุมัติ"}
            </button>
            <button type="button" disabled={pending} className="rounded-md bg-slate-700 px-3 py-1.5 text-white disabled:opacity-60" onClick={() => decide(request.id, "REJECTED")}>ไม่อนุมัติ</button>
          </div>
        </article>
      ))}
    </section>
  );

  function decide(id: string, decision: "APPROVED" | "REJECTED") {
    setBusyId(id);
    start(async () => {
      const saved = await reviewShiftChangeAction(id, decision, decision === "APPROVED" ? "อนุมัติ" : "ไม่อนุมัติ");
      setBusyId(null);
      if (saved.error || !saved.data.ok) toast.error(saved.error || saved.data.message || "บันทึกไม่สำเร็จ");
      else {
        toast.success(decision === "APPROVED" ? "อนุมัติการแก้ไขแล้ว" : "ไม่อนุมัติการแก้ไข");
        onDone?.();
      }
    });
  }
}
