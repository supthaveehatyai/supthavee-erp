"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PhotoLightbox } from "@/components/fnb/photo-lightbox";
import {
  getAuditProfileAction,
  getAuditSummaryAction,
  getForensicDossierAction,
  getFranchiseQaPackAction,
  listAuditPeriodsAction,
  listMonthBackupAction,
  markMonthBackupAction,
  saveAuditProfileAction,
  setAuditPeriodLockAction,
} from "@/lib/actions/fnb-audit";
import { buildStoreZip } from "@/lib/holding/store-zip";
import { FNB_QA_SECTIONS, type FnbAuditPeriodRow, type FnbAuditProfile, type FnbBrandCode, type FnbQaPack } from "@/types/fnb";

const field = "h-10 rounded-md border border-slate-200 px-3 text-sm";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function AuditWorkspace({ brand, branches }: { brand: FnbBrandCode; branches: { branch_code: string; branch_name_th: string }[] }) {
  const [tab, setTab] = useState<"summary" | "forensic" | "qa" | "lock">("summary");
  const [branch, setBranch] = useState(branches[0]?.branch_code ?? "");
  const [workDate, setWorkDate] = useState(today());
  const [startDate, setStartDate] = useState(today().slice(0, 8) + "01");
  const [endDate, setEndDate] = useState(today());
  const [grain, setGrain] = useState("day");
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getAuditSummaryAction>>["data"]>([]);
  const [dossier, setDossier] = useState<Awaited<ReturnType<typeof getForensicDossierAction>>["data"] | null>(null);
  const [query, setQuery] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [profile, setProfile] = useState<FnbAuditProfile | null>(null);
  const [pack, setPack] = useState<FnbQaPack | null>(null);
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [periods, setPeriods] = useState<FnbAuditPeriodRow[]>([]);
  const [reason, setReason] = useState("");
  const [progress, setProgress] = useState("");

  useEffect(() => {
    void getAuditProfileAction(brand).then((loaded) => {
      if (loaded.error) toast.error(loaded.error);
      setProfile(loaded.data);
    });
  }, [brand]);
  useEffect(() => {
    void listAuditPeriodsAction(brand, year).then((loaded) => setPeriods(loaded.data));
  }, [brand, year]);

  const accent = brand === "CHATORN" ? "bg-[#6B0F1A]" : "bg-[#DC2626]";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🛡️ ศูนย์ตรวจสอบย้อนหลัง ล็อกงวด & รายงานส่งแฟรนไชส์</h1>
          <p className="text-sm text-slate-500">ข้อมูลของแบรนด์ที่เลือกเท่านั้น</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {([["summary", "📅 สรุปข้อมูล"], ["forensic", "🔍 สืบค้นย้อนรอย"], ["qa", "📋 รายงานส่งตรวจแฟรนไชส์"], ["lock", "🔒 ล็อกงวดและสำรองเดือน"]] as const).map(([key, label]) => (
          <button key={key} type="button" className={`rounded-full px-3 py-1 text-sm ${tab === key ? `${accent} text-white` : "bg-white"}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "summary" ? (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">📅 สรุปข้อมูล รายวัน / รายสัปดาห์ / รายเดือน / รายปี</h2>
          <div className="flex flex-wrap gap-2">
            {[["day", "รายวัน"], ["week", "รายสัปดาห์"], ["month", "รายเดือน"], ["year", "รายปี"]].map(([key, label]) => (
              <button key={key} type="button" className={`rounded-full px-3 py-1 text-sm ${grain === key ? `${accent} text-white` : "bg-slate-100"}`} onClick={() => setGrain(key)}>{label}</button>
            ))}
            <input className={field} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <input className={field} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            <button type="button" className={`rounded-md px-3 py-2 text-sm text-white ${accent}`} onClick={() => void getAuditSummaryAction(brand, startDate, endDate, grain).then((loaded) => { setSummary(loaded.data); if (loaded.error) toast.error(loaded.error); })}>สรุป</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead><tr className="border-b">{["งวด", "สาขา", "ตรงเวลา %", "เปิดร้าน %", "ปิดร้าน %", "ยอด POS", "เงินนำฝาก", "ของเสียบาท", "ของเสีย %", "ของหาย", "เคลม"].map((head) => <th key={head} className="px-2 py-1">{head}</th>)}</tr></thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={`${row.period}-${row.branchCode}`} className="border-b">
                    <td className="px-2 py-1">{row.period}</td>
                    <td className="px-2 py-1">{row.branchCode}</td>
                    <td className="px-2 py-1">{row.punctualPct.toFixed(0)}</td>
                    <td className="px-2 py-1">{row.openingPct.toFixed(0)}</td>
                    <td className="px-2 py-1">{row.closingPct.toFixed(0)}</td>
                    <td className="px-2 py-1">{row.posSales.toFixed(2)}</td>
                    <td className="px-2 py-1">{row.cashDeposited.toFixed(2)}</td>
                    <td className="px-2 py-1">{row.wasteBaht.toFixed(2)}</td>
                    <td className="px-2 py-1">{row.wastePct.toFixed(1)}</td>
                    <td className="px-2 py-1">{row.shrinkageCount}</td>
                    <td className="px-2 py-1">{row.vendorClaims}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "forensic" ? (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">🔍 สืบค้นย้อนรอยกรณีลูกค้าร้องเรียน</h2>
          <div className="flex flex-wrap gap-2">
            <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code} {item.branch_name_th}</option>)}</select>
            <input className={field} type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
            <input className={field} type="time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} />
            <input className={field} type="time" value={toTime} onChange={(event) => setToTime(event.target.value)} />
            <input className={field} value={query} placeholder="คำค้นเมนูหรือวัตถุดิบ" onChange={(event) => setQuery(event.target.value)} />
            <button type="button" className={`rounded-md px-3 py-2 text-sm text-white ${accent}`} onClick={() => void getForensicDossierAction({ brand, branchCode: branch, workDate, fromTime, toTime, query }).then((loaded) => { setDossier(loaded.data); if (loaded.error) toast.error(loaded.error); })}>เปิดแฟ้ม</button>
          </div>
          {dossier ? (
            <div className="space-y-3 text-sm">
              <p>พนักงานในกะ: {dossier.staff.join(", ") || "—"}</p>
              {dossier.confirms.map((row, index) => <p key={index}>{row.title} · {row.staff} · {row.at}</p>)}
              <h3 className="font-semibold">เบสที่ต้ม</h3>
              {dossier.brews.map((row, index) => <p key={index}>{row.label} · {row.portion} · {row.staff} · {row.at}</p>)}
              <h3 className="font-semibold">ของเปิดใช้และใบรับเข้า</h3>
              {dossier.containers.map((row, index) => <p key={index}>{row.label} · เปิด {row.openedAt} · หมดอายุ {row.expiresAt} · {row.grNo} · {row.vendor} · ล็อต {row.lotExpiry}</p>)}
              <h3 className="font-semibold">ล็อตตู้โชว์</h3>
              {dossier.displayLots.map((row, index) => <p key={index}>{row.item} {row.qty} หมด {row.expiry}</p>)}
              <PhotoLightbox photos={dossier.photos} />
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "qa" && profile ? (
        <section className="space-y-3">
          <div className="space-y-3 rounded-xl border bg-white p-4 print:hidden">
            <h2 className="font-semibold">📋 รายงานส่งตรวจแฟรนไชส์</h2>
            <p className="text-sm text-slate-600">ชุดนี้ไม่มียอดขาย เงินสด ราคาทุน บิลซื้อในร้าน หรือชื่อแบรนด์อื่น</p>
            <input className={`${field} w-full`} value={profile.headerTitle} onChange={(event) => setProfile({ ...profile, headerTitle: event.target.value })} />
            {FNB_QA_SECTIONS.map((section) => (
              <label key={section.key} className="flex gap-2 text-sm">
                <input type="checkbox" checked={profile.sections[section.key] === true} onChange={(event) => setProfile({ ...profile, sections: { ...profile.sections, [section.key]: event.target.checked } })} />
                {section.label}
              </label>
            ))}
            {profile.sections.cleaning_spot_photos ? (
              <div className="grid gap-1 md:grid-cols-2">
                {profile.spots.map((spot) => (
                  <label key={spot.id} className="flex gap-2 text-xs">
                    <input type="checkbox" checked={profile.spotIds.length === 0 || profile.spotIds.includes(spot.id)} onChange={(event) => {
                      const all = profile.spotIds.length === 0 ? profile.spots.map((item) => item.id) : profile.spotIds;
                      const next = event.target.checked ? [...new Set([...all, spot.id])] : all.filter((id) => id !== spot.id);
                      setProfile({ ...profile, spotIds: next.length === profile.spots.length ? [] : next });
                    }} />
                    {spot.branchCode} · {spot.name}
                  </label>
                ))}
              </div>
            ) : null}
            {profile.extraTopics.map((topic, index) => (
              <input key={index} className={`${field} w-full`} value={topic} onChange={(event) => setProfile({ ...profile, extraTopics: profile.extraTopics.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} />
            ))}
            <button type="button" className="rounded-md border px-3 py-1 text-sm" onClick={() => setProfile({ ...profile, extraTopics: [...profile.extraTopics, ""] })}>➕ เพิ่มหัวข้อตรวจรับรองเพิ่มเติมเอง</button>
            <div className="grid gap-2 md:grid-cols-2">
              {profile.signoffTitles.map((title, index) => <input key={index} className={field} value={title} onChange={(event) => setProfile({ ...profile, signoffTitles: profile.signoffTitles.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} />)}
            </div>
            <div className="flex flex-wrap gap-2">
              <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}</select>
              <input className={field} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              <input className={field} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void saveAuditProfileAction({ brand, sections: profile.sections, spotIds: profile.spotIds, extraTopics: profile.extraTopics.filter(Boolean), headerTitle: profile.headerTitle, signoffTitles: profile.signoffTitles }).then((saved) => saved.error || !saved.data.ok ? toast.error(saved.error || "บันทึกไม่สำเร็จ") : toast.success("บันทึกเป็นแม่แบบมาตรฐานแล้ว"))}>💾 บันทึกเป็นแม่แบบมาตรฐาน</button>
              <button type="button" className={`rounded-md px-3 py-2 text-sm text-white ${accent}`} onClick={() => void getFranchiseQaPackAction({ brand, branchCode: branch, startDate, endDate, sections: profile.sections, spotIds: profile.spotIds }).then((loaded) => { setPack(loaded.data); if (loaded.error) toast.error(loaded.error); })}>สร้างรายงาน</button>
              <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => window.print()}>พิมพ์ / บันทึก PDF</button>
              <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void exportQaExcel(pack)}>บันทึก Excel</button>
            </div>
          </div>
          {pack ? <QaPrint pack={pack} branch={branch} /> : null}
        </section>
      ) : null}

      {tab === "lock" ? (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">🔒 ล็อกข้อมูลปิดงวดประจำเดือน</h2>
            <input className={`${field} w-28`} type="number" value={year} onChange={(event) => setYear(Number(event.target.value) || year)} />
          </div>
          <input className={`${field} w-full`} value={reason} placeholder="สาเหตุปลดล็อก" onChange={(event) => setReason(event.target.value)} />
          {progress ? <p className="text-sm text-amber-800">{progress}</p> : null}
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b"><th className="px-2 py-1">เดือน</th><th>สถานะ</th><th>ผู้ล็อก</th><th>สำรองล่าสุด</th><th></th></tr></thead>
            <tbody>
              {periods.map((row) => (
                <tr key={row.month} className="border-b">
                  <td className="px-2 py-2">{row.month}/{row.year}</td>
                  <td>{row.isLocked ? "🔒 ล็อกปิดงวดแล้ว" : "🟢 เปิดใช้งาน"}</td>
                  <td>{row.lockedByName} {row.lockedAt ? row.lockedAt.slice(0, 16) : ""}</td>
                  <td>{row.lastBackupAt ? row.lastBackupAt.slice(0, 16) : "—"}</td>
                  <td className="space-x-2 py-2">
                    <button type="button" className="rounded-md border px-2 py-1" onClick={() => void setAuditPeriodLockAction({ brand, year, month: row.month, lock: !row.isLocked, reason }).then((saved) => { if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกงวดไม่สำเร็จ"); else { toast.success(row.isLocked ? "ปลดล็อกแล้ว" : "ล็อกงวดแล้ว"); void listAuditPeriodsAction(brand, year).then((loaded) => setPeriods(loaded.data)); } })}>{row.isLocked ? "🔓 ปลดล็อกชั่วคราว" : "🔒 ล็อกข้อมูลประจำเดือน"}</button>
                    <button type="button" className="rounded-md border px-2 py-1" onClick={() => void downloadMonth(brand, year, row.month, setProgress)}>📦 ดาวน์โหลดชุด Backup ประจำเดือน</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function QaPrint({ pack, branch }: { pack: FnbQaPack; branch: string }) {
  return (
    <article id="fnb-qa-print" className="erp-print-document space-y-4 rounded-xl border bg-white p-4 text-sm print:border-0">
      <h2 className="text-xl font-bold">{pack.headerTitle || "รายงานมาตรฐานคุณภาพ"}</h2>
      <p>สาขา {branch}</p>
      {pack.equipment.length ? <table className="w-full"><tbody>{pack.equipment.map((row, index) => <tr key={index}><td>{row.workDate}</td><td>โดส {row.doseG ?? "—"} g</td><td>ช็อต {row.shotSec ?? "—"} s / {row.shotG ?? "—"} g</td><td>น้ำเชื่อม {row.syrupActualG ?? "—"} / {row.syrupTargetG ?? "—"} g</td></tr>)}</tbody></table> : null}
      {pack.sauces.map((row, index) => <p key={index}>{row.label} · เปิด {row.openedAt} · หมดอายุ {row.expiresAt} · {row.sticker}</p>)}
      {pack.lots.map((row, index) => <p key={index}>{row.item} คงเหลือ {row.qty} {row.uom} หมด {row.expiry}</p>)}
      {pack.cleaning.map((row, index) => <p key={index}>{row.spot} · {row.staff} · {row.at} · {row.status}</p>)}
      {pack.wip.map((row, index) => <p key={index}>{row.label} · {row.portion} · {row.staff} · {row.at}</p>)}
      {pack.displayLots.map((row, index) => <p key={index}>{row.item} {row.qty} หมด {row.expiry}</p>)}
      {pack.destructions.map((row, index) => <p key={index}>{row.item} · {row.reason} · {row.qty} · {row.destroyed ? "ทำลายสภาพแล้ว" : "ยังไม่ยืนยันทำลาย"}</p>)}
      <div className="grid grid-cols-4 gap-2">
        {[...pack.cleaning.flatMap((row) => row.photos), ...pack.wip.flatMap((row) => row.photos), ...pack.destructions.flatMap((row) => row.photos)].slice(0, 24).map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={url} src={url} alt="" className="h-24 w-full object-cover" />
        ))}
      </div>
      {pack.extraTopics.map((topic) => <p key={topic} className="mt-4 border-t pt-3">{topic}<span className="mt-6 block">ลงชื่อ ................................</span></p>)}
      <div className="grid gap-6 pt-8 md:grid-cols-2">
        {pack.signoffTitles.map((title) => <p key={title}>{title}<span className="mt-8 block">ลงชื่อ ................................</span></p>)}
      </div>
    </article>
  );
}

async function exportQaExcel(pack: FnbQaPack | null) {
  if (!pack) {
    toast.error("สร้างรายงานก่อนบันทึก Excel");
    return;
  }
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, string | number | null>[]) => {
    if (rows.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  };
  add("equipment", pack.equipment);
  add("sauces", pack.sauces);
  add("lots", pack.lots);
  add("cleaning", pack.cleaning.map((row) => ({ spot: row.spot, staff: row.staff, at: row.at, status: row.status })));
  add("wip", pack.wip.map((row) => ({ label: row.label, portion: row.portion, staff: row.staff, at: row.at })));
  add("display", pack.displayLots);
  add("destruction", pack.destructions.map((row) => ({ item: row.item, reason: row.reason, qty: row.qty, destroyed: row.destroyed ? "yes" : "no" })));
  const data = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  downloadBlob(new Blob([data]), "franchise-qa-pack.xlsx");
}

async function downloadMonth(brand: FnbBrandCode, year: number, month: number, setProgress: (value: string) => void) {
  const loaded = await listMonthBackupAction(brand, year, month);
  if (loaded.error) {
    toast.error(loaded.error);
    return;
  }
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(loaded.data.sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  }
  const sheet = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const files: { name: string; data: Uint8Array }[] = [{ name: `fnb-${year}-${month}.xlsx`, data: new Uint8Array(sheet) }];
  const photos = loaded.data.photos;
  for (let index = 0; index < photos.length; index += 1) {
    setProgress(`กำลังรวบรวมรูปภาพ ${index + 1} / ${photos.length} ใบ...`);
    try {
      const response = await fetch(photos[index].url);
      if (response.ok) files.push({ name: `photos/${photos[index].name}`, data: new Uint8Array(await response.arrayBuffer()) });
    } catch {
      setProgress(`ข้ามรูปที่ดาวน์โหลดไม่ได้ ${index + 1}`);
    }
  }
  const fileName = `fnb-backup-${brand}-${year}-${String(month).padStart(2, "0")}.zip`;
  downloadBlob(buildStoreZip(files), fileName);
  const marked = await markMonthBackupAction({ brand, year, month, fileName, photoCount: photos.length });
  setProgress("");
  if (marked.error || !marked.data.ok) toast.error(marked.error || "บันทึกประวัติสำรองไม่สำเร็จ");
  else toast.success("ดาวน์โหลดชุดสำรองเดือนนี้แล้ว");
}
