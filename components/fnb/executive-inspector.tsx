"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PhotoLightbox } from "@/components/fnb/photo-lightbox";
import { useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { getExecutiveInspectorAction, voidDuplicateWipBatchAction } from "@/lib/actions/fnb-audit";
import { swapShiftCrewSeatAction } from "@/lib/actions/fnb-live-sync";
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

function BatchCard({ title, empty, hasRows, children }: { title: string; empty: string; hasRows: boolean; children: ReactNode }) {
  return (
    <section className="rounded-xl border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {hasRows ? children : <p className="text-xs text-slate-500">{empty}</p>}
    </section>
  );
}

function CrewSwapButton() {
  const live = useLiveBranch();
  const [open, setOpen] = useState(false);
  const [removeId, setRemoveId] = useState("");
  const [nextId, setNextId] = useState("");
  const [reason, setReason] = useState("");
  const roster = live.snapshot?.rosters.find((item) => item.shiftSlot === live.shiftSlot);
  if (!live.snapshot?.viewer.isSupervisor) return null;
  return (
    <div>
      <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => setOpen((value) => !value)}>🔄 เปลี่ยนตัวผู้ปฏิบัติงานในกะ</button>
      {open ? (
        <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2">
          <select className="h-9 rounded-md border px-2 text-xs" value={removeId} onChange={(event) => setRemoveId(event.target.value)}>
            <option value="">คนที่ออกจากกะ</option>
            {(roster?.members ?? []).map((member) => <option key={member.userId} value={member.userId}>{member.staffName}</option>)}
          </select>
          <select className="h-9 rounded-md border px-2 text-xs" value={nextId} onChange={(event) => setNextId(event.target.value)}>
            <option value="">คนที่เข้าแทน</option>
            {(live.snapshot?.staffOptions ?? []).map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
          </select>
          <input className="h-9 rounded-md border px-2 text-xs" placeholder="สาเหตุอย่างน้อย 4 ตัวอักษร" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="button" className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white" onClick={() => {
            const next = live.snapshot?.staffOptions.find((person) => person.userId === nextId);
            void swapShiftCrewSeatAction({
              branchCode: live.snapshot?.branchCode || "",
              workDate: live.snapshot?.workDate || "",
              shiftSlot: live.shiftSlot,
              removeUserId: removeId,
              newUserId: nextId,
              newStaffName: next?.name || "",
              reason,
            }).then((saved) => {
              if (saved.error || !saved.data.ok) toast.error(saved.error || "เปลี่ยนตัวไม่สำเร็จ");
              else { toast.success("เปลี่ยนตัวผู้ปฏิบัติงานแล้ว"); setOpen(false); void live.refresh(); }
            });
          }}>บันทึกการเปลี่ยนตัว</button>
        </div>
      ) : null}
    </div>
  );
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
  const [tick, setTick] = useState(0);
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
  }, [props.brand, props.workDate, props.branch, tick]);
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
                <td className="px-3 py-2 font-semibold">{row.branchCode}<div className="text-xs font-normal text-slate-600">☀️ กะเช้า: {row.shift1Crew.join(", ") || "ยังไม่ลงชื่อ"}</div><div className="text-xs font-normal text-slate-600">🌤️ กะบ่าย: {row.shift2Crew.join(", ") || "ยังไม่ลงชื่อ"}</div></td>
                <td className="px-3 py-2">{openingLabel(row.openingDone, row.openingFinishedAt, props.workDate)}</td>
                <td className="px-3 py-2">{simpleLabel(row.wipCount > 0, row.wipAt, "⚪ ยังไม่เริ่ม", `🟢 มีบันทึก ${row.wipCount} รายการ`)}</td>
                <td className="px-3 py-2">{simpleLabel(Boolean(row.shift1Staff), row.shift1At, "⚪ ยังไม่เริ่ม", `🟢 ${row.shift1Staff}`)}<div className="text-xs">☀️ กะเช้า: {row.shift1Crew.join(", ") || "ยังไม่ลงชื่อ"}</div></td>
                <td className="px-3 py-2">{simpleLabel(Boolean(row.shift2Staff), row.shift2At, "⚪ ยังไม่เริ่ม", `🟢 ${row.shift2Staff}`)}<div className="text-xs">🌤️ กะบ่าย: {row.shift2Crew.join(", ") || "ยังไม่ลงชื่อ"}</div></td>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">แผงตรวจ {props.branch || "สาขา"}</h2>
          <CrewSwapButton />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {(detail?.openingCards ?? []).map((card) => (
            <section key={card.no} className="rounded-xl border p-3 text-sm">
              <h3 className="font-semibold">{card.title}</h3>
              <div className="mt-1 space-y-0.5">
                {card.lines.map((line) => <p key={line} className={line.includes("นอกช่วง") ? "font-semibold text-red-700" : ""}>{line}</p>)}
              </div>
              {card.zeroNote ? <p className="mt-1 text-xs text-slate-500">{card.zeroNote}</p> : null}
              {card.photos.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {card.photos.map((photo) => (
                    <a key={photo.url} href={photo.url} target="_blank" rel="noreferrer" className="block w-16">
                      <img src={photo.url} alt={photo.caption} className="h-16 w-16 rounded object-cover" />
                      <span className="block truncate text-[10px] text-slate-500">{photo.caption}</span>
                    </a>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-xs text-slate-600">{card.staff ? `${card.staff} · ${hm(card.at)} น.` : "ยังไม่บันทึก"}</p>
            </section>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <BatchCard title="🫖 เบสที่ต้มวันนี้" empty="ยังไม่มีเบสที่ต้มวันนี้" hasRows={(detail?.prepRows.length ?? 0) > 0}>
            <table className="w-full text-left text-xs">
              <thead><tr className="text-slate-500"><th className="py-1">เบส</th><th>สัดส่วน</th><th>ปริมาณที่ได้</th><th>ผู้ทำ & เวลา</th></tr></thead>
              <tbody>
                {(detail?.prepRows ?? []).map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="py-1 pr-2">{row.label}</td>
                    <td><span className="rounded-full bg-[#DC2626] px-2 py-0.5 font-bold text-white">{row.portion}</span></td>
                    <td className="px-2">{row.yieldLabel}</td>
                    <td>{row.staff} · {hm(row.at)} น.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </BatchCard>
          <BatchCard title="🥫 ซอสและวัตถุดิบหน้าบาร์" empty="ยังไม่มีซอสหรือวัตถุดิบเปิดใช้" hasRows={(detail?.openRows.length ?? 0) > 0}>
            <table className="w-full text-left text-xs">
              <thead><tr className="text-slate-500"><th className="py-1">วัตถุดิบ</th><th>จำนวน</th><th>กำหนดหมดอายุ</th><th>ผู้ทำ & เวลา</th><th /></tr></thead>
              <tbody>
                {(detail?.openRows ?? []).map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="py-1 pr-2">{row.label}</td>
                    <td className="font-bold">{row.qtyLabel} <span className="font-normal text-slate-500">{row.badge}</span></td>
                    <td className="px-2">{row.expiryLabel}</td>
                    <td>{row.staff} · {hm(row.at)} น.</td>
                    <td><button type="button" className="rounded px-1 text-slate-500" title="ซ่อนรายการกดซ้ำ" onClick={() => {
                      void voidDuplicateWipBatchAction(row.id).then((saved) => {
                        if (saved.error || !saved.data.ok) toast.error(saved.error || "ซ่อนรายการไม่สำเร็จ");
                        else { toast.success("ซ่อนรายการกดซ้ำแล้ว"); setTick((value) => value + 1); }
                      });
                    }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </BatchCard>
        </div>
        <PhotoLightbox photos={detail?.photos ?? []} />
      </article>
    </section>
  );
}
