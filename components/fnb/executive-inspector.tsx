"use client";

import { useEffect, useState } from "react";
import { PhotoLightbox } from "@/components/fnb/photo-lightbox";
import { getExecutiveInspectorAction } from "@/lib/actions/fnb-audit";
import { bangkokHour } from "@/lib/fnb/stage-progress";
import type { FnbBrandCode, FnbInspectorDetail, FnbInspectorMatrixRow } from "@/types/fnb";

function hm(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function openingLabel(done: number, at: string | null, workDate: string): string {
  const past = workDate < today() || (workDate === today() && bangkokHour() >= 10);
  const clock = hm(at);
  if (done <= 0) return past ? "🔴 ส่งสาย" : "⚪ ยังไม่เริ่ม";
  if (done < 7) return past ? `🔴 ส่งสาย ${done}/7` : `🟡 กำลังทำ ${done}/7`;
  if (clock > "09:30") return `🔴 ส่งสาย 7/7 · ${clock} น.`;
  return `🟢 ครบ 7/7${clock ? ` · ${clock} น.` : ""}`;
}

function simpleLabel(done: boolean, at: string | null, empty: string, doneText: string): string {
  if (!done) return empty;
  const clock = hm(at);
  return `${doneText}${clock ? ` · ${clock} น.` : ""}`;
}

export function ExecutiveInspector(props: { brand: FnbBrandCode; workDate: string; branch: string; onPickBranch: (code: string) => void }) {
  const [matrix, setMatrix] = useState<FnbInspectorMatrixRow[]>([]);
  const [detail, setDetail] = useState<FnbInspectorDetail | null>(null);
  const [anomalies, setAnomalies] = useState<{ branchCode: string; kind: string; detail: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getExecutiveInspectorAction(props.brand, props.workDate, props.branch).then((loaded) => {
      if (!active) return;
      setMatrix(loaded.data.matrix);
      setDetail(loaded.data.detail);
      setAnomalies(loaded.data.anomalies);
      setError(loaded.error ?? "");
    });
    return () => { active = false; };
  }, [props.brand, props.workDate, props.branch]);
  const tone = props.brand === "CHATORN" ? "border-[#6B0F1A]" : "border-[#DC2626]";
  return (
    <section className="space-y-4">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className={`overflow-x-auto rounded-xl border bg-white ${tone}`}>
        <table className="min-w-full text-left text-sm">
          <thead className={props.brand === "CHATORN" ? "bg-[#6B0F1A] text-white" : "bg-[#DC2626] text-white"}>
            <tr>
              <th className="px-3 py-2">สาขา</th>
              <th className="px-3 py-2">เปิดร้าน (7 หมวด)</th>
              <th className="px-3 py-2">ต้มเบส/เติมบาร์ระหว่างวัน</th>
              <th className="px-3 py-2">ส่งเงินกะแรก</th>
              <th className="px-3 py-2">ส่งเงินกะสอง</th>
              <th className="px-3 py-2">ปิดร้าน & สลิปรายเมนู</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.branchCode} className={`cursor-pointer border-t ${row.branchCode === props.branch ? "bg-amber-50" : ""}`} onClick={() => props.onPickBranch(row.branchCode)}>
                <td className="px-3 py-2 font-semibold">{row.branchCode}<div className="text-xs font-normal text-slate-500">{row.staffNames.join(", ")}</div></td>
                <td className="px-3 py-2">{openingLabel(row.openingDone, row.openingFinishedAt, props.workDate)}</td>
                <td className="px-3 py-2">{simpleLabel(row.wipCount > 0, row.wipAt, "⚪ ยังไม่เริ่ม", `🟢 มีบันทึก ${row.wipCount} รายการ`)}</td>
                <td className="px-3 py-2">{simpleLabel(Boolean(row.shift1Staff), row.shift1At, "⚪ ยังไม่เริ่ม", `🟢 ${row.shift1Staff}`)}</td>
                <td className="px-3 py-2">{simpleLabel(Boolean(row.shift2Staff), row.shift2At, "⚪ ยังไม่เริ่ม", `🟢 ${row.shift2Staff}`)}</td>
                <td className="px-3 py-2">{simpleLabel(row.closingDone, row.closingAt, "⚪ ยังไม่เริ่ม", "🟢 ปิดร้านแล้ว")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <article className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-semibold">⚠️ รายการผิดปกติที่ต้องตรวจเช็กวันนี้</h2>
        {anomalies.length === 0 ? <p className="mt-2 text-sm text-emerald-800">✅ วันนี้ทุกหมวดอยู่ในเกณฑ์มาตรฐาน ไม่พบรายการผิดปกติ</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {anomalies.map((row, index) => <li key={`${row.branchCode}-${index}`}>{row.branchCode} · {row.kind}: {row.detail}</li>)}
          </ul>
        )}
      </article>
      <article className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">แผงตรวจ {props.branch || "สาขา"}</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {(detail?.sections ?? []).map((row) => (
            <div key={row.key} className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-medium">{row.title}</p>
              <p>{row.status === "ISSUE_REPORTED" ? "⚠️ พบจุดชำรุด" : "ยืนยันแล้ว"} · {row.staff} · {hm(row.at)} น.</p>
            </div>
          ))}
        </div>
        <div className="space-y-1 text-sm">
          {(detail?.wip ?? []).map((row, index) => <p key={`${row.label}-${index}`}>ต้ม/เปิดใช้ {row.label} · {row.portion} · {row.staff} · {hm(row.at)} น. {row.sticker}</p>)}
          {(detail?.replenishments ?? []).map((row, index) => <p key={`${row.item}-${index}`}>เบิกเติม {row.item} {row.qty}</p>)}
          {(detail?.shifts ?? []).map((row) => <p key={row.shift}>กะ {row.shift} · {row.staff}{row.variance !== 0 ? ` · คลาดเคลื่อน ${row.variance.toFixed(2)} บาท` : ""}</p>)}
        </div>
        <PhotoLightbox photos={detail?.photos ?? []} />
      </article>
    </section>
  );
}
