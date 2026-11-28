"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { ShiftIncidentBlock } from "@/components/fnb/shift-incident-block";
import { extractFnbPosSlipOcrAction, listBranchMenusForSalesAction, uploadFnbPosSlipAction } from "@/lib/actions/fnb-pos-ocr";
import { acknowledgeMorningCashHandoverAction, submitShiftClosingAndMenuSalesAction } from "@/lib/actions/fnb-shift-handover";
import { useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { bangkokClock } from "@/lib/fnb/stage-progress";
import { drawerCustody } from "@/lib/utils/fnb-cash";
import { FNB_NOTE_VALUES, type FnbBrandCode, type FnbPosMenuSlipLine, type FnbShiftHandoverInput } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";
const CATEGORY_WARNING = "⚠️ สลิปใบนี้เป็นแบบสรุปหมวดหมู่ กรุณาปริ้นท์ใบ \"รายงานยอดขายสินค้า -> จัดกลุ่มตาม: สินค้าและหมวดหมู่\" เพื่อให้ได้ชื่อเมนูและจำนวนแก้วครบทุกตัว";

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function countedOf(notes: Record<number, number>): number {
  return FNB_NOTE_VALUES.reduce((sum, face) => sum + face * (notes[face] ?? 0), 0);
}

async function storeSlip(branch: string, file: File): Promise<string> {
  const body = new FormData();
  body.set("branch_code", branch);
  body.set("file", file);
  const uploaded = await uploadFnbPosSlipAction(body);
  if (uploaded.error || !uploaded.data.url) throw new Error(uploaded.error || "อัปโหลดสลิปไม่สำเร็จ");
  return uploaded.data.url;
}

function SlipCapture(props: { label: string; action: string; onFile: (file: File) => void }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => {
      event.preventDefault();
      event.stopPropagation();
      const file = event.dataTransfer.files?.[0];
      if (file) props.onFile(file);
    }}>
      <p>{props.label}</p>
      <label className="mt-2 inline-block cursor-pointer rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
        {props.action}
        <input className="hidden" type="file" accept="image/*" capture="environment" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) props.onFile(file);
          event.currentTarget.value = "";
        }} />
      </label>
    </div>
  );
}

function ChannelBoxes(props: {
  cash: number; qr: number; lineman: number; grab: number; webapp: number;
  onCash: (value: number) => void; onQr: (value: number) => void; onLineman: (value: number) => void; onGrab: (value: number) => void; onWebapp: (value: number) => void;
  hint?: string;
}) {
  const box = (label: string, value: number, onChange: (value: number) => void) => (
    <label className="text-xs">{label}<input className={field} type="number" step="0.01" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || 0)} /></label>
  );
  return (
    <div className="grid gap-2 md:grid-cols-5">
      {box(`1. เงินสด POS (Cash)${props.hint ? ` ${props.hint}` : ""}`, props.cash, props.onCash)}
      {box("2. เงินโอน (THAI QR)", props.qr, props.onQr)}
      {box("3. LineMan", props.lineman, props.onLineman)}
      {box("4. GrabFood", props.grab, props.onGrab)}
      {box("5. LuckyCup App (Web & App)", props.webapp, props.onWebapp)}
    </div>
  );
}

function NoteCounter(props: { notes: Record<number, number>; onChange: (notes: Record<number, number>) => void }) {
  return (
    <details className="rounded-lg border bg-white p-3" open>
      <summary className="cursor-pointer text-sm font-medium">นับธนบัตรและเหรียญในเก๊ะ</summary>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {FNB_NOTE_VALUES.map((face) => (
          <label key={face} className="text-xs">{face}
            <input className={field} type="number" min={0} value={props.notes[face] ?? ""} onChange={(event) => props.onChange({ ...props.notes, [face]: Number(event.target.value) || 0 })} />
          </label>
        ))}
      </div>
    </details>
  );
}

function MenuEditor(props: {
  lines: FnbPosMenuSlipLine[];
  menus: { id: string; name: string; cupSize: string; pending: boolean }[];
  morning?: FnbPosMenuSlipLine[];
  cumulative: boolean;
  slipUrl?: string;
  onChange: (lines: FnbPosMenuSlipLine[]) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = props.menus.filter((menu) => menu.name.includes(query.trim())).slice(0, 8);
  function patch(index: number, next: Partial<FnbPosMenuSlipLine>) {
    props.onChange(props.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...next } : line));
  }
  const qtySum = props.lines.reduce((sum, line) => sum + line.qtySold, 0);
  const bahtSum = props.lines.reduce((sum, line) => sum + line.salesAmount, 0);
  return (
    <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
      {props.slipUrl ? <a href={props.slipUrl} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={props.slipUrl} alt="สลิปเมนู POS" className="max-h-80 w-full rounded object-contain" /></a> : <p className="text-xs text-slate-500">รูปสลิปเมนูจะอยู่ข้างตารางหลังถ่ายใบที่ 2</p>}
      <div className="space-y-2">
      <p className="text-sm font-semibold">ตารางตรวจทานรายการเมนูเทียบสลิป POS — แก้ไขได้ทุกช่อง</p>
      <div className="flex flex-wrap gap-2">
        <input className={`${field} max-w-xs`} placeholder="ค้นหาเมนูเพื่อเพิ่มแถว" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query.trim() ? matches.map((menu) => (
          <button key={menu.id} type="button" className="rounded-full bg-slate-100 px-3 py-1 text-xs" onClick={() => {
            props.onChange([...props.lines, { rawMenuName: menu.name, cupSize: menu.cupSize || "R", qtySold: 1, salesAmount: 0, posCategoryName: "", menuId: menu.id, matchedName: menu.name, isNewMenu: menu.pending }]);
            setQuery("");
          }}>{menu.name} {menu.cupSize}</button>
        )) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th>ชื่อเมนู</th><th>ไซส์</th><th>จำนวน</th><th>ยอดเงิน (฿)</th>
              {props.cumulative ? <th>สะสมทั้งวัน</th> : null}
              {props.cumulative ? <th>หักกะเช้า</th> : null}
              {props.cumulative ? <th>ขายช่วงบ่ายสุทธิ</th> : null}
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {props.lines.map((line, index) => {
              const morningQty = (props.morning ?? []).find((item) => item.rawMenuName === line.rawMenuName && item.cupSize === line.cupSize)?.qtySold ?? 0;
              const net = Math.max(0, line.qtySold - morningQty);
              return (
                <tr key={`${line.rawMenuName}-${index}`} className="border-t">
                  <td>
                    <input className={field} list={`fnb-menu-${index}`} value={line.rawMenuName} onChange={(event) => {
                      const found = props.menus.find((menu) => menu.name === event.target.value);
                      patch(index, found ? { rawMenuName: found.name, menuId: found.id, cupSize: found.cupSize || line.cupSize, isNewMenu: found.pending, matchedName: found.name } : { rawMenuName: event.target.value, menuId: null, isNewMenu: true });
                    }} />
                    <datalist id={`fnb-menu-${index}`}>{props.menus.map((menu) => <option key={menu.id} value={menu.name}>{menu.cupSize}</option>)}</datalist>
                  </td>
                  <td>
                    <select className={field} value={line.cupSize} onChange={(event) => patch(index, { cupSize: event.target.value })}>
                      <option value="R">R</option><option value="L">L</option><option value="16A">16A</option><option value="SINGLE">-</option>
                    </select>
                  </td>
                  <td><FnbQtyInput value={String(line.qtySold)} unit="แก้ว" onChange={(value) => patch(index, { qtySold: Math.round(Number(value) || 0) })} /></td>
                  <td><input className={field} type="number" step="0.01" value={line.salesAmount} onChange={(event) => patch(index, { salesAmount: Number(event.target.value) || 0 })} /></td>
                  {props.cumulative ? <td className="px-2">{line.qtySold}</td> : null}
                  {props.cumulative ? <td className="px-2">{morningQty}</td> : null}
                  {props.cumulative ? <td className="px-2 font-semibold">{net}</td> : null}
                  <td className="px-2">{line.isNewMenu ? "🆕 เมนูใหม่" : "🟢 ผูกเมนูแล้ว"}</td>
                  <td><button type="button" className="text-xs text-red-700" onClick={() => props.onChange(props.lines.filter((_, lineIndex) => lineIndex !== index))}>🗑️ ลบแถว</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" className="rounded-md border px-3 py-1" onClick={() => props.onChange([...props.lines, { rawMenuName: "", cupSize: "R", qtySold: 1, salesAmount: 0, posCategoryName: "", menuId: null, matchedName: "", isNewMenu: true }])}>➕ เพิ่มรายการเมนูที่ตกหล่น</button>
        <p>รวมจำนวนในตาราง: {qtySum} แก้ว/ชิ้น · รวมเป็นเงิน {money(bahtSum)} ฿ (กรุณาตรวจให้ตรงกับท้ายสลิปก่อนกดบันทึก)</p>
      </div>
      </div>
    </div>
  );
}

function useMenuCatalog(branch: string) {
  const [menus, setMenus] = useState<{ id: string; name: string; cupSize: string; pending: boolean }[]>([]);
  useEffect(() => {
    if (!branch) return;
    void listBranchMenusForSalesAction(branch).then((loaded) => setMenus(loaded.data));
  }, [branch]);
  return menus;
}

export function MorningHandoverPanel(props: { branch: string; workDate: string; brand: FnbBrandCode; brandLock: FnbBrandCode | null; actorSource: string; cashFloat: number }) {
  const live = useLiveBranch();
  const menus = useMenuCatalog(props.branch);
  const float = props.cashFloat || 1200;
  const [cash, setCash] = useState(0);
  const [qr, setQr] = useState(0);
  const [lineman, setLineman] = useState(0);
  const [grab, setGrab] = useState(0);
  const [webapp, setWebapp] = useState(0);
  const [gross, setGross] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [orders, setOrders] = useState(0);
  const [kshop, setKshop] = useState(0);
  const [linemanApp, setLinemanApp] = useState(0);
  const [grabNet, setGrabNet] = useState(0);
  const [grabGp, setGrabGp] = useState(0);
  const [promo, setPromo] = useState(0);
  const [deliveryDisc, setDeliveryDisc] = useState(0);
  const [storeDisc, setStoreDisc] = useState(0);
  const [cashMode, setCashMode] = useState<"ABOVE" | "FULL">("ABOVE");
  const [manualCash, setManualCash] = useState(0);
  const [noWaste, setNoWaste] = useState(false);
  const [notes, setNotes] = useState<Record<number, number>>({});
  const [lines, setLines] = useState<FnbPosMenuSlipLine[]>([]);
  const [posUrls, setPosUrls] = useState<string[]>([]);
  const [menuUrls, setMenuUrls] = useState<string[]>([]);
  const [linemanUrls, setLinemanUrls] = useState<string[]>([]);
  const [grabUrls, setGrabUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const hydrated = useRef(false);
  const morning = live.snapshot?.closings.find((row) => row.shiftType === "MORNING");
  const enteredCash = countedOf(notes) || manualCash;
  const drawer = cashMode === "ABOVE" ? float + enteredCash : enteredCash;
  const expected = float + cash;
  const diff = drawer - expected;
  const handoverCash = Math.max(0, drawer - float);

  useEffect(() => {
    if (hydrated.current || !morning) return;
    hydrated.current = true;
    setCash(morning.cashPosAmount);
    setQr(morning.qrAmount);
    setLineman(morning.linemanAmount);
    setGrab(morning.grabAmount);
    setWebapp(morning.webappAmount);
    setGross(morning.grossSales);
    setDiscount(morning.discountTotal);
    setOrders(morning.orderCount);
    setKshop(morning.kshopAmount);
    setLinemanApp(morning.linemanAppAmount);
    setGrabNet(morning.grabNet);
    const savedLines = (live.snapshot?.shiftMenuSales ?? []).filter((row) => row.shiftType === "MORNING");
    if (savedLines.length > 0) {
      setLines(savedLines.map((row) => ({
        rawMenuName: row.rawMenuName,
        cupSize: row.cupSize,
        qtySold: row.qtySold,
        salesAmount: row.salesAmount,
        posCategoryName: row.categoryName,
        menuId: row.menuId || null,
        matchedName: row.rawMenuName,
        isNewMenu: row.wasAutoCreated,
      })));
    }
  }, [live.snapshot?.shiftMenuSales, morning]);

  async function readFinancial(file: File) {
    setBusy("pos");
    try {
      const url = await storeSlip(props.branch, file);
      setPosUrls((current) => [...current, url]);
      const extracted = await extractFnbPosSlipOcrAction({ imageUrls: [url], slipKind: "FINANCIAL_SUMMARY", branchCode: props.branch });
      if (extracted.error || !extracted.data.financial) {
        toast.error(extracted.error || "ดึงยอดจากสลิปไม่สำเร็จ");
        return;
      }
      const slip = extracted.data.financial;
      setCash(slip.cashAmount);
      setQr(slip.thaiQrAmount);
      setLineman(slip.linemanAmount);
      setGrab(slip.grabfoodAmount);
      setWebapp(slip.webAppAmount);
      setGross(slip.grossSales);
      setDiscount(slip.discountTotal);
      setPromo(slip.promoCouponDiscount);
      setDeliveryDisc(slip.deliveryPriceDiffDiscount);
      setStoreDisc(slip.storeManualDiscount);
      setOrders(slip.orderCount);
      toast.success("ดึงยอด 5 ช่องทางและส่วนลดแล้ว ตรวจตัวเลขก่อนบันทึก");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ดึงยอดจากสลิปไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function readMenus(file: File) {
    setBusy("menu");
    try {
      const url = await storeSlip(props.branch, file);
      setMenuUrls((current) => [...current, url]);
      const extracted = await extractFnbPosSlipOcrAction({ imageUrls: [url], slipKind: "MENU_SALES", branchCode: props.branch });
      if (extracted.error) {
        toast.error(extracted.error);
        return;
      }
      if (extracted.data.isCategoryOnlyWarning) {
        toast.error(CATEGORY_WARNING);
        setLines([]);
        return;
      }
      setLines(extracted.data.lines);
      toast.success("ถอดรายการเมนูกะเช้าแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ถอดรายการเมนูไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    if (!noWaste) { toast.error("ยืนยันว่ากะเช้าไม่มีการทำเมนูผิดหรือของเสียหายเพิ่มเติม หรือบันทึกรายการเสียหายก่อน"); return; }
    setBusy("save");
    const payload: FnbShiftHandoverInput = {
      branchCode: props.branch,
      workDate: props.workDate,
      shiftType: "MORNING",
      posSlipMode: "SHIFT_ONLY",
      menuSlipIsCumulative: false,
      orderCount: orders,
      grossSales: gross,
      discountTotal: discount,
      cashPos: cash,
      qr,
      lineman,
      grab,
      webapp,
      drawerTotal: drawer,
      breakdown: FNB_NOTE_VALUES.map((face) => ({ face, qty: notes[face] ?? 0 })),
      kshopApp: kshop,
      linemanApp,
      grabGp,
      grabNet,
      depositChannel: "HOLD_FOR_AFTERNOON",
      sevenAmount: 0,
      sevenSlipUrl: "",
      posSlipUrls: posUrls,
      menuSlipUrls: menuUrls,
      appScreenUrls: [...linemanUrls, ...grabUrls],
      linemanScreenUrls: linemanUrls,
      grabScreenUrls: grabUrls,
      promoCouponDiscount: promo,
      deliveryDiscount: deliveryDisc,
      storeManualDiscount: storeDisc,
      noShiftWasteConfirmed: noWaste,
      menuLines: lines.map((line) => ({ raw_menu_name: line.rawMenuName, cup_size: line.cupSize, qty_sold: line.qtySold, sales_amount: line.salesAmount, pos_category_name: line.posCategoryName })),
      note: "",
      overrideReason: "",
      actorSource: props.actorSource,
      brandLock: props.brandLock,
    };
    const saved = await submitShiftClosingAndMenuSalesAction(payload);
    setBusy("");
    if (saved.error || saved.data.ok !== true) {
      toast.error(saved.error || "บันทึกส่งยอดกะเช้าไม่สำเร็จ");
      return;
    }
    toast.success(saved.data.createdMenus > 0 ? `ส่งยอดกะเช้าแล้ว และเพิ่มเมนูใหม่ ${saved.data.createdMenus} รายการ` : "ส่งยอดกะเช้าและเงินสดในเก๊ะให้กะบ่ายแล้ว");
    void live.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-white p-4">
      <h2 className="font-semibold">2. ส่งเงินกะแรก (สรุปส่งมอบให้กะบ่าย)</h2>
      <p className="text-sm text-slate-600">กะเช้าส่งยอดเงินในเก๊ะให้กะบ่ายตรวจ กะเช้าไม่ไปฝาก 7-Eleven ตอนเที่ยง</p>
      <div className="grid gap-3 md:grid-cols-4">
        <SlipCapture label="📸 ถ่ายสลิป POS รายงานยอดขายตามช่วงเวลา" action={`🤖 ดึงยอดขาย 5 ช่องทาง & ส่วนลดด้วย AI${busy === "pos" ? " ..." : ""}`} onFile={(file) => { void readFinancial(file); }} />
        <SlipCapture label="📸 ถ่ายสลิป POS รายงานยอดขายสินค้า (สินค้าและหมวดหมู่)" action={`🤖 ถอดรายการเมนู + จำนวนแก้ว + ราคาด้วย AI${busy === "menu" ? " ..." : ""}`} onFile={(file) => { void readMenus(file); }} />
        <SlipCapture label="รายงาน LineMan" action={linemanUrls.length ? `แนบแล้ว ${linemanUrls.length} รูป` : "แนบรายงาน LineMan"} onFile={(file) => { void storeSlip(props.branch, file).then((url) => setLinemanUrls((current) => [...current, url])).catch((error: Error) => toast.error(error.message)); }} />
        <SlipCapture label="รายงาน Grab / K SHOP" action={grabUrls.length ? `แนบแล้ว ${grabUrls.length} รูป` : "แนบรายงาน Grab / K SHOP"} onFile={(file) => { void storeSlip(props.branch, file).then((url) => setGrabUrls((current) => [...current, url])).catch((error: Error) => toast.error(error.message)); }} />
      </div>
      <ChannelBoxes cash={cash} qr={qr} lineman={lineman} grab={grab} webapp={webapp} onCash={setCash} onQr={setQr} onLineman={setLineman} onGrab={setGrab} onWebapp={setWebapp} />
      <div className="grid gap-2 md:grid-cols-4">
        <label className="text-xs">จำนวนออเดอร์รวม (บิล)<input className={field} type="number" value={orders || ""} onChange={(event) => setOrders(Number(event.target.value) || 0)} /></label>
        <label className="text-xs">ยอดขายรวมก่อนลด<input className={field} type="number" step="0.01" value={gross || ""} onChange={(event) => setGross(Number(event.target.value) || 0)} /></label>
        <label className="text-xs">🎟️ ส่วนลดคูปอง / โปรโมชั่นสมาชิก<input className={field} type="number" step="0.01" value={promo || ""} onChange={(event) => setPromo(Number(event.target.value) || 0)} /></label>
        <label className="text-xs">🛵 ส่วนต่างราคาเดลิเวอรี<input className={field} type="number" step="0.01" value={deliveryDisc || ""} onChange={(event) => setDeliveryDisc(Number(event.target.value) || 0)} /></label>
        <label className="text-xs">🏷️ ส่วนลดหน้าร้านอื่นๆ<input className={field} type="number" step="0.01" value={storeDisc || ""} onChange={(event) => setStoreDisc(Number(event.target.value) || 0)} /></label>
      </div>
      <details className="rounded-lg bg-slate-50 p-3 text-sm">
        <summary>ยอดหน้าแอปอ้างอิง (ไม่บังคับ)</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <label>ยอดหน้าแอป K SHOP<input className={field} type="number" step="0.01" value={kshop || ""} onChange={(event) => setKshop(Number(event.target.value) || 0)} /></label>
          <label>LineMan สุทธิ<input className={field} type="number" step="0.01" value={linemanApp || ""} onChange={(event) => setLinemanApp(Number(event.target.value) || 0)} /></label>
          <label>Grab สุทธิ<input className={field} type="number" step="0.01" value={grabNet || ""} onChange={(event) => setGrabNet(Number(event.target.value) || 0)} /></label>
          <label>หัก GP Grab<input className={field} type="number" step="0.01" value={grabGp || ""} onChange={(event) => setGrabGp(Number(event.target.value) || 0)} /></label>
        </div>
      </details>
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" className={`rounded-full px-3 py-1 ${cashMode === "ABOVE" ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setCashMode("ABOVE")}>กรอกเงินสดขายที่นับได้เหนือเงินทอน {money(float)}</button>
        <button type="button" className={`rounded-full px-3 py-1 ${cashMode === "FULL" ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setCashMode("FULL")}>กรอกรวมทั้งเก๊ะ</button>
      </div>
      <NoteCounter notes={notes} onChange={setNotes} />
      <label className="text-sm">หรือพิมพ์ยอด{cashMode === "ABOVE" ? "เงินสดขายเหนือเงินทอน" : "รวมทั้งเก๊ะ"}<input className={field} type="number" step="0.01" value={manualCash || ""} onChange={(event) => setManualCash(Number(event.target.value) || 0)} /></label>
      <article className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
        <p>เงินทอนตั้งต้นติดเก๊ะ ({money(float)} ฿) + ขายเงินสดกะเช้าตาม POS ({money(cash)} ฿) = <strong>ควรมีเงินสดในเก๊ะรวม {money(expected)} ฿</strong></p>
        <p className="font-semibold">รวมเงินในเก๊ะจริง {money(drawer)} ฿ = {money(float)} + ขายสดที่นับได้ {money(handoverCash)} ฿</p>
        <p>ส่วนต่างเทียบ POS: {money(diff)} ฿ · เงินสดขายส่งต่อกะบ่าย {money(handoverCash)} ฿</p>
      </article>
      <MenuEditor lines={lines} menus={menus} cumulative={false} slipUrl={menuUrls[0]} onChange={setLines} />
      <ShiftIncidentBlock branch={props.branch} workDate={props.workDate} brand={props.brand} actorSource={props.actorSource === "liff" ? "liff" : "desktop"} staffName={live.snapshot?.viewer.name || "พนักงาน"} shiftType="MORNING" confirmed={noWaste} onConfirmed={setNoWaste} />
      <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm font-semibold text-white" onClick={() => { void submit(); }}>{busy === "save" ? "กำลังบันทึก..." : "📤 บันทึกส่งยอดกะเช้า & ส่งมอบเงินสดในเก๊ะให้กะบ่าย"}</button>
    </section>
  );
}

export function AfternoonHandoverPanel(props: { branch: string; workDate: string; brand: FnbBrandCode; brandLock: FnbBrandCode | null; actorSource: string; cashFloat: number }) {
  const live = useLiveBranch();
  const menus = useMenuCatalog(props.branch);
  const float = props.cashFloat || 1200;
  const morning = live.snapshot?.closings.find((row) => row.shiftType === "MORNING");
  const morningLines = (live.snapshot?.shiftMenuSales ?? []).filter((row) => row.shiftType === "MORNING").map((row) => ({
    rawMenuName: row.rawMenuName,
    cupSize: row.cupSize,
    qtySold: row.qtySold,
    salesAmount: row.salesAmount,
    posCategoryName: row.categoryName,
    menuId: row.menuId || null,
    matchedName: row.rawMenuName,
    isNewMenu: row.wasAutoCreated,
  }));
  const [counted, setCounted] = useState(0);
  const [ackNote, setAckNote] = useState("");
  const [ackPhoto, setAckPhoto] = useState("");
  const [mode, setMode] = useState<"SHIFT_ONLY" | "CUMULATIVE_FULL_DAY">("SHIFT_ONLY");
  const [menuCumulative, setMenuCumulative] = useState(props.brand === "LUCKY_CUP");
  const [categoryWarning, setCategoryWarning] = useState(false);
  const [cash, setCash] = useState(0);
  const [qr, setQr] = useState(0);
  const [lineman, setLineman] = useState(0);
  const [grab, setGrab] = useState(0);
  const [webapp, setWebapp] = useState(0);
  const [gross, setGross] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [orders, setOrders] = useState(0);
  const [notes, setNotes] = useState<Record<number, number>>({});
  const [lines, setLines] = useState<FnbPosMenuSlipLine[]>([]);
  const [grabGp, setGrabGp] = useState(0);
  const [promo, setPromo] = useState(0);
  const [deliveryDisc, setDeliveryDisc] = useState(0);
  const [storeDisc, setStoreDisc] = useState(0);
  const [noWaste, setNoWaste] = useState(false);
  const [posUrls, setPosUrls] = useState<string[]>([]);
  const [menuUrls, setMenuUrls] = useState<string[]>([]);
  const [linemanUrls, setLinemanUrls] = useState<string[]>([]);
  const [grabUrls, setGrabUrls] = useState<string[]>([]);
  const [deposit, setDeposit] = useState<"SEVEN_ELEVEN_EOD" | "BANK_DIRECT" | "SAFE_OVERNIGHT">("SEVEN_ELEVEN_EOD");
  const [sevenUrl, setSevenUrl] = useState("");
  const [busy, setBusy] = useState("");
  const drawer = countedOf(notes) || counted;
  const morningSalesCash = morning?.cashCountedAmount ?? 0;
  const afternoonSalesCash = Math.max(0, drawer - float - morningSalesCash);
  const depositTarget = Math.max(0, drawer - float);
  const showSplit = mode === "CUMULATIVE_FULL_DAY" && morning;
  const cashNet = showSplit ? Math.max(0, cash - (morning?.cashPosAmount ?? 0)) : cash;
  const qrNet = showSplit ? Math.max(0, qr - (morning?.qrAmount ?? 0)) : qr;
  const linemanNet = showSplit ? Math.max(0, lineman - (morning?.linemanAmount ?? 0)) : lineman;
  const grabNet = showSplit ? Math.max(0, grab - (morning?.grabAmount ?? 0)) : grab;
  const appNet = showSplit ? Math.max(0, webapp - (morning?.webappAmount ?? 0)) : webapp;

  async function acknowledge() {
    setBusy("ack");
    const saved = await acknowledgeMorningCashHandoverAction({
      branchCode: props.branch,
      workDate: props.workDate,
      countedDrawerCash: counted,
      photoUrl: ackPhoto,
      note: ackNote,
      actorSource: props.actorSource,
      brandLock: props.brandLock,
    });
    setBusy("");
    if (saved.error || saved.data.ok !== true) {
      toast.error(saved.error || "กดรับยอดเงินสดไม่สำเร็จ");
      return;
    }
    toast.success("ยืนยันรับมอบเงินสดกะเช้าแล้ว");
    void live.refresh();
  }

  async function readFinancial(file: File) {
    setBusy("pos");
    try {
      const url = await storeSlip(props.branch, file);
      setPosUrls((current) => [...current, url]);
      const extracted = await extractFnbPosSlipOcrAction({ imageUrls: [url], slipKind: "FINANCIAL_SUMMARY", branchCode: props.branch });
      if (extracted.error || !extracted.data.financial) {
        toast.error(extracted.error || "ดึงยอดจากสลิปไม่สำเร็จ");
        return;
      }
      const slip = extracted.data.financial;
      setCash(slip.cashAmount);
      setQr(slip.thaiQrAmount);
      setLineman(slip.linemanAmount);
      setGrab(slip.grabfoodAmount);
      setWebapp(slip.webAppAmount);
      setGross(slip.grossSales);
      setDiscount(slip.discountTotal);
      setPromo(slip.promoCouponDiscount);
      setDeliveryDisc(slip.deliveryPriceDiffDiscount);
      setStoreDisc(slip.storeManualDiscount);
      setOrders(slip.orderCount);
      if (slip.isFullDayCumulative) setMode("CUMULATIVE_FULL_DAY");
      toast.success(slip.isFullDayCumulative ? "สลิปนี้เป็นยอดสะสมทั้งวัน ระบบจะหักกะเช้าให้อัตโนมัติ" : "ดึงยอดช่วงบ่ายแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ดึงยอดจากสลิปไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function readMenus(file: File) {
    setBusy("menu");
    try {
      const url = await storeSlip(props.branch, file);
      setMenuUrls((current) => [...current, url]);
      const extracted = await extractFnbPosSlipOcrAction({ imageUrls: [url], slipKind: "MENU_SALES", branchCode: props.branch });
      if (extracted.error) {
        toast.error(extracted.error);
        return;
      }
      if (extracted.data.isCategoryOnlyWarning) {
        setCategoryWarning(true);
        setLines([]);
        toast.error(CATEGORY_WARNING);
        return;
      }
      setCategoryWarning(false);
      setLines(extracted.data.lines);
      toast.success("ถอดรายการเมนูแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ถอดรายการเมนูไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    if (!noWaste) { toast.error("ยืนยันว่ากะบ่ายไม่มีการทำเมนูผิดหรือของเสียหายเพิ่มเติม หรือบันทึกรายการเสียหายก่อน"); return; }
    setBusy("save");
    const saved = await submitShiftClosingAndMenuSalesAction({
      branchCode: props.branch,
      workDate: props.workDate,
      shiftType: "AFTERNOON",
      posSlipMode: mode,
      menuSlipIsCumulative: menuCumulative,
      orderCount: orders,
      grossSales: gross,
      discountTotal: discount,
      cashPos: cash,
      qr,
      lineman,
      grab,
      webapp,
      drawerTotal: drawer,
      breakdown: FNB_NOTE_VALUES.map((face) => ({ face, qty: notes[face] ?? 0 })),
      kshopApp: 0,
      linemanApp: 0,
      grabGp,
      grabNet: 0,
      depositChannel: deposit,
      sevenAmount: deposit === "SEVEN_ELEVEN_EOD" ? depositTarget : 0,
      sevenSlipUrl: sevenUrl,
      posSlipUrls: posUrls,
      menuSlipUrls: menuUrls,
      appScreenUrls: [...linemanUrls, ...grabUrls],
      linemanScreenUrls: linemanUrls,
      grabScreenUrls: grabUrls,
      promoCouponDiscount: promo,
      deliveryDiscount: deliveryDisc,
      storeManualDiscount: storeDisc,
      noShiftWasteConfirmed: noWaste,
      menuLines: lines.map((line) => ({ raw_menu_name: line.rawMenuName, cup_size: line.cupSize, qty_sold: line.qtySold, sales_amount: line.salesAmount, pos_category_name: line.posCategoryName })),
      note: "",
      overrideReason: "",
      actorSource: props.actorSource,
      brandLock: props.brandLock,
    });
    setBusy("");
    if (saved.error || saved.data.ok !== true) {
      toast.error(saved.error || "บันทึกปิดยอดกะบ่ายไม่สำเร็จ");
      return;
    }
    toast.success(saved.data.createdMenus > 0 ? `ปิดยอดกะบ่ายแล้ว และเพิ่มเมนูใหม่ ${saved.data.createdMenus} รายการ` : "ปิดยอดกะบ่ายและยอดฝากแล้ว");
    void live.refresh();
  }

  const acceptedClock = morning?.handoverAcceptedAt ? bangkokClock(morning.handoverAcceptedAt).replace(/:\d{2} น\.$/, " น.") : "";

  return (
    <section className="space-y-3">
      <article className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
        <h2 className="font-semibold">🤝 ตรวจสอบและกดรับยอดเงินสดในเก๊ะจากกะเช้า</h2>
        {morning ? (
          <p className="text-sm">ผู้ส่งกะเช้า: {morning.staffName || "-"} · รวมเงินในเก๊ะจริง {money(drawerCustody(morning.openingFloat || float, morning.drawerTotal, morning.cashHandover).total)} ฿ (เงินทอน {money(morning.openingFloat || float)} + ขายสดเช้า {money(morning.cashPosAmount)} ฿)</p>
        ) : <p className="text-sm">ทีมกะเช้ายังไม่ได้กดส่งสรุปยอดเงินสดของวันนี้</p>}
        {morning?.handoverStatus === "ACCEPTED_BY_AFTERNOON" ? <p className="text-sm font-semibold">ผู้รับตรวจสอบ: {morning.handoverAcceptedByName} · เวลา {acceptedClock}</p> : null}
        <label className="block text-sm">ยอดเงินสดในเก๊ะที่กะบ่ายนับรับจริง (฿)
          <input className={field} type="number" step="0.01" value={counted || ""} onChange={(event) => setCounted(Number(event.target.value) || 0)} />
        </label>
        <label className="block text-sm">หมายเหตุ (จำเป็นเมื่อยอดไม่ตรง)
          <input className={field} value={ackNote} onChange={(event) => setAckNote(event.target.value)} />
        </label>
        <SlipCapture label="รูปเงินในเก๊ะ (ถ้ามี)" action="แนบรูปเก๊ะ" onFile={(file) => { void storeSlip(props.branch, file).then(setAckPhoto).catch((error: Error) => toast.error(error.message)); }} />
        <button type="button" className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => { void acknowledge(); }}>{busy === "ack" ? "กำลังบันทึก..." : "✅ ยืนยันตรวจนับและรับมอบเงินสดกะเช้า"}</button>
      </article>
      <article className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">ปิดยอดกะบ่าย และรวบฝาก 7-Eleven ครั้งเดียวหลังปิดร้าน</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${mode === "SHIFT_ONLY" ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setMode("SHIFT_ONLY")}>สลิปเฉพาะช่วงบ่าย (ตั้งเวลาเริ่มหลังกะเช้า)</button>
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${mode === "CUMULATIVE_FULL_DAY" ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setMode("CUMULATIVE_FULL_DAY")}>สลิปสะสมรวมทั้งวัน (00:00–ปิดร้าน) — หักยอดกะเช้าออกให้อัตโนมัติ!</button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={menuCumulative} onChange={(event) => setMenuCumulative(event.target.checked)} />
          สลิปเมนูสะสมทั้งวัน → คำนวณแก้วกะบ่าย = รวมทั้งวัน − กะเช้า อัตโนมัติ
        </label>
        <div className="grid gap-3 md:grid-cols-4">
          <SlipCapture label="📸 ถ่ายสลิป POS รายงานยอดขายตามช่วงเวลา" action="🤖 ดึงยอดขาย 5 ช่องทาง & ส่วนลดด้วย AI" onFile={(file) => { void readFinancial(file); }} />
          <SlipCapture label="📸 ถ่ายสลิป POS รายงานยอดขายสินค้า (สินค้าและหมวดหมู่)" action="🤖 ถอดรายการเมนู + จำนวนแก้ว + ราคาด้วย AI" onFile={(file) => { void readMenus(file); }} />
          <SlipCapture label="รายงาน LineMan" action={linemanUrls.length ? `แนบแล้ว ${linemanUrls.length} รูป` : "แนบรายงาน LineMan"} onFile={(file) => { void storeSlip(props.branch, file).then((url) => setLinemanUrls((current) => [...current, url])).catch((error: Error) => toast.error(error.message)); }} />
          <SlipCapture label="รายงาน Grab / K SHOP" action={grabUrls.length ? `แนบแล้ว ${grabUrls.length} รูป` : "แนบรายงาน Grab / K SHOP"} onFile={(file) => { void storeSlip(props.branch, file).then((url) => setGrabUrls((current) => [...current, url])).catch((error: Error) => toast.error(error.message)); }} />
        </div>
        {categoryWarning ? <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">{CATEGORY_WARNING}</p> : null}
        <ChannelBoxes cash={cash} qr={qr} lineman={lineman} grab={grab} webapp={webapp} onCash={setCash} onQr={setQr} onLineman={setLineman} onGrab={setGrab} onWebapp={setWebapp} />
        {showSplit ? (
          <p className="text-sm">
            Cash (รวมทั้งวัน {money(cash)} − กะเช้า {money(morning?.cashPosAmount ?? 0)} = เฉพาะกะบ่าย {money(cashNet)}) ·
            QR ({money(qr)} − {money(morning?.qrAmount ?? 0)} = {money(qrNet)}) ·
            LineMan ({money(lineman)} − {money(morning?.linemanAmount ?? 0)} = {money(linemanNet)}) ·
            Grab ({money(grab)} − {money(morning?.grabAmount ?? 0)} = {money(grabNet)}) ·
            App ({money(webapp)} − {money(morning?.webappAmount ?? 0)} = {money(appNet)})
          </p>
        ) : null}
        <NoteCounter notes={notes} onChange={(next) => { setNotes(next); setCounted(countedOf(next)); }} />
        <article className="rounded-lg bg-emerald-50 p-3 text-sm">
          <p>เงินสดรวมทั้งเก๊ะก่อนปิดร้าน {money(drawer)} ฿ − หักเก็บเงินทอนติดเก๊ะไว้พรุ่งนี้ ({money(float)} ฿)</p>
          <p className="font-semibold">💵 ยอดเงินสดขายรวมทั้งวันที่ต้องนำฝาก 7-Eleven ครั้งเดียว ({money(morningSalesCash + afternoonSalesCash)} ฿)</p>
          <p>ขายสดเช้า {money(morningSalesCash)} + ขายสดบ่าย {money(afternoonSalesCash)}</p>
        </article>
        <div className="space-y-2 text-sm">
          <label className="flex gap-2"><input type="radio" checked={deposit === "SEVEN_ELEVEN_EOD"} onChange={() => setDeposit("SEVEN_ELEVEN_EOD")} />🏪 ฝากผ่าน 7-Eleven หลังปิดร้าน (ตั้งโอนคืนค่าธรรมเนียม 15 ฿ อัตโนมัติ)</label>
          <label className="flex gap-2"><input type="radio" checked={deposit === "BANK_DIRECT"} onChange={() => setDeposit("BANK_DIRECT")} />🏦 ฝากเข้าตู้/ธนาคาร (ฟรีค่าธรรมเนียม)</label>
          <label className="flex gap-2"><input type="radio" checked={deposit === "SAFE_OVERNIGHT"} onChange={() => setDeposit("SAFE_OVERNIGHT")} />🔐 เก็บตู้เซฟรอนำฝากเช้าพรุ่งนี้</label>
          {deposit === "SEVEN_ELEVEN_EOD" ? <SlipCapture label="แนบสลิปฝาก 7-Eleven" action="แนบสลิป 7-Eleven" onFile={(file) => { void storeSlip(props.branch, file).then(setSevenUrl).catch((error: Error) => toast.error(error.message)); }} /> : null}
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-xs">🎟️ ส่วนลดคูปอง / โปรโมชั่นสมาชิก<input className={field} type="number" step="0.01" value={promo || ""} onChange={(event) => setPromo(Number(event.target.value) || 0)} /></label>
          <label className="text-xs">🛵 ส่วนต่างราคาเดลิเวอรี<input className={field} type="number" step="0.01" value={deliveryDisc || ""} onChange={(event) => setDeliveryDisc(Number(event.target.value) || 0)} /></label>
          <label className="text-xs">🏷️ ส่วนลดหน้าร้านอื่นๆ<input className={field} type="number" step="0.01" value={storeDisc || ""} onChange={(event) => setStoreDisc(Number(event.target.value) || 0)} /></label>
        </div>
        <MenuEditor lines={lines} menus={menus} morning={menuCumulative ? morningLines : []} cumulative={menuCumulative} slipUrl={menuUrls[0]} onChange={setLines} />
        <ShiftIncidentBlock branch={props.branch} workDate={props.workDate} brand={props.brand} actorSource={props.actorSource === "liff" ? "liff" : "desktop"} staffName={live.snapshot?.viewer.name || "พนักงาน"} shiftType="AFTERNOON" confirmed={noWaste} onConfirmed={setNoWaste} />
        <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm font-semibold text-white" onClick={() => { void submit(); }}>{busy === "save" ? "กำลังบันทึก..." : "บันทึกปิดยอดกะบ่ายและยอดฝาก"}</button>
      </article>
    </section>
  );
}
