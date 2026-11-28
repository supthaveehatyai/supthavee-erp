"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { getExecutiveInspectorAction, voidDuplicateWipBatchAction } from "@/lib/actions/fnb-audit";
import { swapShiftCrewSeatAction } from "@/lib/actions/fnb-live-sync";
import { bangkokHour } from "@/lib/fnb/stage-progress";
import type { FnbBrandCode, FnbInspectorDetail, FnbInspectorMatrixRow, FnbInspectorShiftCard, FnbSopStageInstance } from "@/types/fnb";

function hm(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function baht(value: number): string {
  return `${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
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

function ZoomThumbs({ photos }: { photos: { url: string; caption: string; staff?: string; at?: string }[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const photo = index == null ? null : photos[index];
  if (photos.length === 0) return null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {photos.map((item, photoIndex) => (
          <button key={`${item.url}-${photoIndex}`} type="button" className="w-20 text-left" onClick={() => setIndex(photoIndex)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.caption} className="h-16 w-16 rounded object-cover" />
            <span className="block truncate text-[10px] text-slate-500">{item.caption}</span>
          </button>
        ))}
      </div>
      {photo && index != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setIndex(null)}>
          <div className="max-w-4xl" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={photo.caption} className="max-h-[75vh] w-full object-contain" />
            <p className="mt-2 text-center text-sm text-white">{photo.caption}{photo.staff ? ` · ${photo.staff}` : ""}{photo.at ? ` · ${hm(photo.at)} น.` : ""}</p>
          </div>
        </div>
      ) : null}
    </>
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

const STAGES: { id: FnbSopStageInstance | "WIP"; label: string }[] = [
  { id: "OPENING", label: "☀️ 1. เปิดร้าน (ครบทั้ง 7 หมวด)" },
  { id: "WIP", label: "🫖 ต้มเบสเพิ่ม & เบิกเปิดของขึ้นบาร์ (ระหว่างวัน)" },
  { id: "SHIFT_1", label: "💵 2. ส่งเงินกะแรก (สรุปยอดกะเช้าส่งมอบกะบ่าย)" },
  { id: "SHIFT_2", label: "🏦 3. รับเงินกะเช้า & ปิดยอดกะสอง (รวบฝาก 7-Eleven หลังปิดร้าน)" },
  { id: "CLOSING", label: "🌙 4. ปิดร้าน & เช็คของหาย (เฉพาะงานปิดร้านช่วงค่ำจริง!)" },
];

export function ExecutiveInspector(props: {
  brand: FnbBrandCode;
  workDate: string;
  branch: string;
  stage: FnbSopStageInstance | "WIP";
  onStage: (stage: FnbSopStageInstance | "WIP") => void;
  onPickBranch: (code: string) => void;
  roster: ReactNode;
}) {
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
        <p className="px-3 pt-3 text-sm font-semibold">ภาพรวมสถานะปฏิบัติการทุกสาขา</p>
        <table className="min-w-full text-left text-sm">
          <thead className={props.brand === "CHATORN" ? "bg-[#6B0F1A] text-white" : "bg-[#DC2626] text-white"}>
            <tr>
              <th className="px-3 py-2">สาขา</th>
              <th className="px-3 py-2">เปิดร้าน</th>
              <th className="px-3 py-2">ต้มเบส/บาร์</th>
              <th className="px-3 py-2">ส่งยอดกะเช้า</th>
              <th className="px-3 py-2">ปิดยอดกะบ่าย</th>
              <th className="px-3 py-2">ปิดร้าน</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.branchCode} className={`cursor-pointer border-t ${row.branchCode === props.branch ? "bg-amber-50" : ""}`} onClick={() => props.onPickBranch(row.branchCode)}>
                <td className="px-3 py-2 font-semibold">{row.branchCode}<div className="text-xs font-normal text-slate-600">☀️ กะเช้า: {row.shift1Crew.join(", ") || "ยังไม่ลงชื่อ"}</div><div className="text-xs font-normal text-slate-600">🌤️ กะบ่าย: {row.shift2Crew.join(", ") || "ยังไม่ลงชื่อ"}</div></td>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">🔎 แผงตรวจปฏิบัติการสาขา {props.branch || "สาขา"}</h2>
          <CrewSwapButton />
        </div>
        {props.roster}
        <div className="flex flex-wrap gap-2">
          {STAGES.map((item) => (
            <button key={item.id} type="button" className={`rounded-full px-3 py-1.5 text-sm ${props.stage === item.id ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => props.onStage(item.id)}>{item.label}</button>
          ))}
        </div>
        <InspectorStage stage={props.stage} detail={detail} onTick={() => setTick((value) => value + 1)} />
      </article>
    </section>
  );
}

function ChannelGrid({ card, title }: { card: FnbInspectorShiftCard; title: string }) {
  const boxes = [
    ["1. รายการเงินสด (Cash)", baht(card.cash), ""],
    ["2. รายการเงินโอน (ThaiQR)", baht(card.qr), card.kshop > 0 ? `เทียบยอด K SHOP ${baht(card.kshop)}` : ""],
    ["3. ยอดขาย LineMan", baht(card.lineman), card.linemanApp > 0 ? `เทียบแอป LineMan ${baht(card.linemanApp)}` : ""],
    ["4. ยอดขาย GrabFood", baht(card.grab), card.grabGp > 0 || card.grabNet > 0 ? `หัก GP ${baht(card.grabGp)} · สุทธิ ${baht(card.grabNet)}` : ""],
    ["5. ยอดขาย App-LuckyCup (App&Web)", baht(card.webapp), ""],
  ];
  return (
    <section className="rounded-xl border p-3">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm">ยอดขายสุทธิรวม {baht(card.netSales)} · จำนวนออเดอร์ {card.orderCount.toLocaleString("th-TH")}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {boxes.map(([label, value, note]) => (
          <div key={label} className="rounded-lg bg-slate-50 p-2 text-sm">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="font-semibold">{value}</p>
            {note ? <p className="text-xs text-slate-500">{note}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportGroups({ photos }: { photos: FnbInspectorShiftCard["photos"] }) {
  const groups = [...new Set(photos.map((photo) => photo.group))];
  if (groups.length === 0) return <p className="text-sm text-slate-500">ยังไม่มีรายงานแนบของกะนี้</p>;
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group}>
          <p className="text-sm font-medium">{group}</p>
          <ZoomThumbs photos={photos.filter((photo) => photo.group === group).map((photo) => ({ url: photo.url, caption: group }))} />
        </div>
      ))}
    </div>
  );
}

function MenuList({ rows }: { rows: FnbInspectorDetail["menus"] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">ยังไม่มีรายการเมนูของกะนี้</p>;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((row) => <li key={`${row.name}-${row.size}`}>{row.name} {row.size} · {row.qty} แก้ว · {baht(row.amount)}</li>)}
    </ul>
  );
}

function InspectorStage(props: { stage: FnbSopStageInstance | "WIP"; detail: FnbInspectorDetail | null; onTick: () => void }) {
  const detail = props.detail;
  const morning = detail?.shiftCards.find((row) => row.shift === "MORNING") ?? null;
  const afternoon = detail?.shiftCards.find((row) => row.shift === "AFTERNOON") ?? null;
  if (props.stage === "WIP") {
    return (
      <div className="space-y-3">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border p-3">
            <h3 className="mb-2 text-sm font-semibold">🫖 ต้มเบสวันนี้</h3>
            {(detail?.prepRows.length ?? 0) === 0 ? <p className="text-xs text-slate-500">ยังไม่มีเบสที่ต้มวันนี้</p> : (
              <ul className="space-y-2 text-sm">
                {detail?.prepRows.map((row) => (
                  <li key={row.id} className="border-t pt-2">
                    <p>{row.label} <span className="rounded-full bg-[#DC2626] px-2 py-0.5 text-xs font-bold text-white">{row.portion}</span> {row.yieldLabel}</p>
                    <p className="text-xs text-slate-600">{row.badge} · {row.staff} · {hm(row.at)} น.</p>
                    <ZoomThumbs photos={row.photos.map((url) => ({ url, caption: row.label, staff: row.staff, at: row.at }))} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border p-3">
            <h3 className="mb-2 text-sm font-semibold">🥫 ซอส นม และผลไม้สดหน้าบาร์</h3>
            {(detail?.openRows.length ?? 0) === 0 ? <p className="text-xs text-slate-500">ยังไม่มีซอสหรือวัตถุดิบเปิดใช้</p> : (
              <ul className="space-y-2 text-sm">
                {detail?.openRows.map((row) => (
                  <li key={row.id} className="border-t pt-2">
                    <p className="font-semibold">{row.label} · {row.qtyLabel}</p>
                    <p className="text-xs text-slate-600">{row.badge} · หมดอายุ {row.expiryLabel} · {row.staff} · {hm(row.at)} น.</p>
                    <ZoomThumbs photos={row.photos.map((url) => ({ url, caption: row.label, staff: row.staff, at: row.at }))} />
                    <button type="button" className="text-xs text-slate-500" onClick={() => {
                      void voidDuplicateWipBatchAction(row.id).then((saved) => {
                        if (saved.error || !saved.data.ok) toast.error(saved.error || "ซ่อนรายการไม่สำเร็จ");
                        else { toast.success("ซ่อนรายการกดซ้ำแล้ว"); props.onTick(); }
                      });
                    }}>ซ่อนรายการกดซ้ำ</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border p-3 text-sm">
            <h3 className="font-semibold">🔄 เบิกของหลังร้านเติมตู้โชว์ระหว่างวัน</h3>
            {(detail?.replenishments.length ?? 0) === 0 ? <p className="text-slate-500">ยังไม่มีการเบิกเติม</p> : detail?.replenishments.map((row) => (
              <p key={`${row.item}-${row.at}`}>{row.item} · {row.qty} · {row.staff} · {hm(row.at)} น.</p>
            ))}
          </section>
          <section className="rounded-xl border p-3 text-sm">
            <h3 className="font-semibold">🗑️ แจ้งตัดของเสีย / แตกหัก / ขึ้นรา</h3>
            {(detail?.writeOffs.length ?? 0) === 0 ? <p className="text-slate-500">ยังไม่มีการตัดของเสีย</p> : detail?.writeOffs.map((row) => (
              <div key={row.id} className="border-t py-2">
                <p>{row.item} · {row.reason} · {row.qty} · {row.staff} · {hm(row.at)} น.</p>
                <ZoomThumbs photos={row.photos.map((url) => ({ url, caption: row.reason, staff: row.staff, at: row.at }))} />
              </div>
            ))}
          </section>
        </div>
      </div>
    );
  }
  if (props.stage === "SHIFT_1") {
    if (!morning) return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">⏳ ทีมกะเช้ายังไม่ได้ส่งสรุปยอดปิดกะแรก</p>;
    const expected = morning.openingFloat + morning.cash;
    const accepted = morning.handoverStatus === "ACCEPTED_BY_AFTERNOON";
    return (
      <div className="space-y-3">
        <ChannelGrid card={morning} title="📊 สรุปยอดขายกะเช้าครบ 5 ช่องทาง" />
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <h3 className="font-semibold">🤝 การส่งมอบเงินสดในเก๊ะให้กะบ่าย (รวบฝาก 7-11 หลังปิดร้าน)</h3>
          <p className="mt-1">เงินทอนตั้งต้น ({baht(morning.openingFloat)}) + ขายสดกะเช้า ({baht(morning.cash)}) = ควรมีในเก๊ะ {baht(expected)}</p>
          <p>นับเงินในเก๊ะจริง: {baht(morning.drawerCounted)} · เงินสดขายส่งต่อกะบ่าย: {baht(morning.cashHandover)} · ส่วนต่าง: {baht(morning.cashVariance)}</p>
          <p className="mt-1 font-semibold">{accepted ? `✅ กะบ่ายตรวจรับยอดแล้วโดย ${morning.handoverAcceptedByName} · เวลา ${hm(morning.handoverAcceptedAt)} น.` : "⏳ รอกะบ่ายตรวจนับกดรับ"}</p>
        </section>
        <section className="rounded-xl border p-3">
          <h3 className="font-semibold">🧾 รายงานการขายแนบจาก POS, LineMan, Grab / K SHOP (เฉพาะกะเช้า)</h3>
          <ReportGroups photos={morning.photos} />
        </section>
        <section className="rounded-xl border p-3">
          <h3 className="font-semibold">🍹 รายการเมนูและจำนวนแก้วที่ขายช่วงเช้า</h3>
          <MenuList rows={(detail?.menus ?? []).filter((row) => row.shift === "MORNING")} />
        </section>
      </div>
    );
  }
  if (props.stage === "SHIFT_2" || props.stage === "SHIFT_3") {
    const accepted = morning?.handoverStatus === "ACCEPTED_BY_AFTERNOON";
    const combined = morning && afternoon ? {
      ...afternoon,
      orderCount: morning.orderCount + afternoon.orderCount,
      netSales: morning.netSales + afternoon.netSales,
      cash: morning.cash + afternoon.cash,
      qr: morning.qr + afternoon.qr,
      kshop: morning.kshop + afternoon.kshop,
      lineman: morning.lineman + afternoon.lineman,
      linemanApp: morning.linemanApp + afternoon.linemanApp,
      grab: morning.grab + afternoon.grab,
      grabGp: morning.grabGp + afternoon.grabGp,
      grabNet: morning.grabNet + afternoon.grabNet,
      webapp: morning.webapp + afternoon.webapp,
    } : null;
    return (
      <div className="space-y-3">
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <h3 className="font-semibold">🤝 ยอดเงินสดยกมาจากกะเช้า</h3>
          {morning ? <p>{accepted ? `✅ กะบ่ายตรวจรับยอดแล้วโดย ${morning.handoverAcceptedByName} · ${hm(morning.handoverAcceptedAt)} น.` : "⏳ รอกะบ่ายตรวจนับกดรับ"} · ส่งต่อ {baht(morning.cashHandover)}</p> : <p>⏳ ทีมกะเช้ายังไม่ได้ส่งสรุปยอดปิดกะแรก</p>}
        </section>
        {afternoon ? <ChannelGrid card={afternoon} title="📊 สรุปยอดขายกะบ่ายครบ 5 ช่องทาง" /> : <p className="rounded-xl border p-3 text-sm">⏳ กะบ่ายยังไม่ได้ปิดยอด</p>}
        {combined ? <ChannelGrid card={combined} title="ยอดรวมทั้งวัน เช้า+บ่าย" /> : null}
        <section className="rounded-xl border p-3 text-sm">
          <h3 className="font-semibold">🏪 สรุปรวบเงินสดฝาก 7-Eleven ครั้งเดียวหลังปิดร้าน</h3>
          <p>ขายสดกะเช้า {baht(morning?.cash ?? 0)} + ขายสดกะบ่าย {baht(afternoon?.cash ?? 0)} = ยอดเงินสดขายรวมทั้งวันที่ต้องนำฝาก {baht(afternoon?.eodDeposit || ((morning?.cash ?? 0) + (afternoon?.cash ?? 0)))}</p>
          <p>หักเก็บติดเก๊ะไว้พรุ่งนี้ {baht(afternoon?.openingFloat || morning?.openingFloat || 1200)} แล้ว</p>
          <p>ช่องทางนำฝาก {afternoon?.depositChannel || "-"} · ยอดนำฝากจริง {baht(afternoon?.sevenAmount ?? 0)} · คิวโอนคืนค่าธรรมเนียมเซเว่น {baht(afternoon?.sevenFee ?? 0)}</p>
          {afternoon?.sevenSlipUrl ? <a className="text-sky-800 underline" href={afternoon.sevenSlipUrl} target="_blank" rel="noreferrer">รูปสลิปฝากเงิน 7-Eleven</a> : <p>ยังไม่มีรูปสลิปฝากเงิน 7-Eleven</p>}
        </section>
        <section className="rounded-xl border p-3">
          <h3 className="font-semibold">🧾 รายงานการขายแนบจาก POS, LineMan, Grab / K SHOP (กะบ่าย/รวมทั้งวัน)</h3>
          <ReportGroups photos={afternoon?.photos ?? []} />
        </section>
        <section className="rounded-xl border p-3">
          <h3 className="font-semibold">🍹 รายการเมนูและจำนวนแก้วที่ขายช่วงบ่าย</h3>
          <MenuList rows={(detail?.menus ?? []).filter((row) => row.shift === "AFTERNOON")} />
        </section>
      </div>
    );
  }
  if (props.stage === "CLOSING") {
    return (
      <div className="space-y-3">
        <section className="rounded-xl border p-3 text-sm">
          <h3 className="font-semibold">หมวดปิดร้านที่ 1: ยืนยันเงินสดติดเก๊ะปิดร้าน (1,200.00 ฿)</h3>
          {detail?.closingCash ? (
            <>
              <p>นับได้ {baht(detail.closingCash.amount)} · เป้า {baht(detail.closingCash.expected)} · {detail.closingCash.staff} · {hm(detail.closingCash.at)} น.</p>
              <ZoomThumbs photos={detail.closingCash.photos.map((photo) => ({ ...photo, staff: detail.closingCash?.staff, at: detail.closingCash?.at }))} />
            </>
          ) : <p className="text-slate-500">ยังไม่ยืนยันเงินสดติดเก๊ะปิดร้าน</p>}
        </section>
        <section className="rounded-xl border p-3 text-sm">
          <h3 className="font-semibold">หมวดปิดร้านที่ 2: ความสะอาดและล้างอุปกรณ์ปิดร้าน ({detail?.closingSpots.length ?? 0} จุด)</h3>
          {(detail?.closingSpots.length ?? 0) === 0 ? <p className="text-slate-500">ยังไม่มีรูปความสะอาดปิดร้าน</p> : (
            <ZoomThumbs photos={(detail?.closingSpots ?? []).map((spot) => ({ url: spot.url, caption: spot.name, staff: spot.staff, at: spot.at }))} />
          )}
        </section>
        <section className="rounded-xl border p-3 text-sm">
          <h3 className="font-semibold">หมวดปิดร้านที่ 3: ตารางเช็คสต็อกและของหายหน้าร้าน (Shrinkage Reconciliation)</h3>
          {(detail?.shrinkage.length ?? 0) === 0 ? <p className="text-slate-500">ยังไม่มีรายการโชว์ใหเทียบยอด</p> : (
            <div className="overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead><tr><th className="py-1">รายการ</th><th>เปิดร้าน</th><th>เบิกเติม</th><th>ขาย</th><th>ตัดเสีย</th><th>ควรเหลือ</th><th>นับจริง</th></tr></thead>
                <tbody>
                  {(detail?.shrinkage ?? []).map((row) => (
                    <tr key={row.item} className={`border-t ${row.missing ? "bg-red-50 text-red-800" : ""}`}>
                      <td className="py-1">{row.item}</td>
                      <td>{row.opening}</td>
                      <td>{row.replenished}</td>
                      <td>{row.sold}</td>
                      <td>{row.wasted}</td>
                      <td>{row.expected} {row.uom}</td>
                      <td>{row.counted == null ? "ยังไม่นับ" : `${row.counted} ${row.uom}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="rounded-xl border p-3 text-sm">
          <h3 className="font-semibold">หมวดปิดร้านที่ 4: บันทึกเททิ้งเบสและเลมอนสดท้ายวัน (EOD Waste)</h3>
          {(detail?.wasteLogs.length ?? 0) === 0 ? <p className="text-slate-500">ยังไม่มีบันทึกของเสียท้ายวัน</p> : detail?.wasteLogs.map((row) => (
            <div key={`${row.staff}-${row.cost}`} className="border-t py-2">
              <p>{row.staff} · มูลค่าเสียหาย {baht(row.cost)}</p>
              {row.notes ? <p className="whitespace-pre-wrap text-slate-600">{row.notes}</p> : null}
              <ZoomThumbs photos={row.photos.map((url) => ({ url, caption: "ของเสียท้ายวัน", staff: row.staff }))} />
            </div>
          ))}
        </section>
      </div>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {(detail?.openingCards ?? []).map((card) => (
        <section key={card.no} className="rounded-xl border p-3 text-sm">
          <h3 className="font-semibold">{card.title}</h3>
          <div className="mt-1 space-y-0.5">
            {card.lines.map((line) => <p key={line} className={line.includes("นอกช่วง") ? "font-semibold text-red-700" : ""}>{line}</p>)}
          </div>
          {card.zeroNote ? <p className="mt-1 text-xs text-slate-500">{card.zeroNote}</p> : null}
          <ZoomThumbs photos={card.photos.map((photo) => ({ url: photo.url, caption: photo.caption, staff: card.staff, at: card.at }))} />
          <p className="mt-2 text-xs text-slate-600">{card.staff ? `${card.staff} · ${hm(card.at)} น.` : "ยังไม่บันทึก"}</p>
        </section>
      ))}
    </div>
  );
}
