"use client";

import { useEffect, useState, useTransition } from "react";
import { confirmHqGoodsReceiptAction, listReceiptLinesAction, markReimbursementsPaidAction, submitBlindGoodsReceiptAction } from "@/lib/actions/fnb-procurement";
import { FNB_DOC_TAX_STATUSES, FNB_VAT_MODES, type FnbBranchOption, type FnbGoodsReceiptLineRow, type FnbGoodsReceiptRow, type FnbItemRow, type FnbReimbursementRow } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

export function ProcurementWorkspace({
  branches,
  receipts,
  payouts,
  items,
  liff,
}: {
  branches: FnbBranchOption[];
  receipts: FnbGoodsReceiptRow[];
  payouts: FnbReimbursementRow[];
  items: Pick<FnbItemRow, "id" | "short_code" | "name_th" | "default_purchase_uom" | "recipe_per_purchase_uom">[];
  liff: boolean;
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{liff ? "รับของเข้าสาขา" : "รับของและชนบิลภาษี"}</h1>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <BlindReceive branches={branches} items={items} pending={pending} start={start} setMessage={setMessage} />
      {liff ? null : <HqMatch branches={branches} receipts={receipts} pending={pending} start={start} setMessage={setMessage} />}
      {liff ? null : <PayoutQueue payouts={payouts} pending={pending} start={start} setMessage={setMessage} />}
    </div>
  );
}

function BlindReceive({
  branches,
  items,
  pending,
  start,
  setMessage,
}: {
  branches: FnbBranchOption[];
  items: Pick<FnbItemRow, "id" | "short_code" | "name_th" | "default_purchase_uom" | "recipe_per_purchase_uom">[];
  pending: boolean;
  start: (callback: () => void) => void;
  setMessage: (message: string) => void;
}) {
  const [lines, setLines] = useState([{ item_id: items[0]?.id ?? "", qty: "", uom: items[0]?.default_purchase_uom ?? "" }]);
  return (
    <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = lines.map((line) => {
        const item = items.find((row) => row.id === line.item_id);
        return {
          item_id: line.item_id,
          item_description: item ? `${item.short_code} ${item.name_th}` : "",
          received_qty: Number(line.qty) || 0,
          received_uom: line.uom || item?.default_purchase_uom || "ชิ้น",
          recipe_qty_per_unit: item?.recipe_per_purchase_uom || 1,
        };
      });
      form.set("lines_json", JSON.stringify(payload));
      start(async () => {
        const saved = await submitBlindGoodsReceiptAction(form);
        setMessage(saved.error ?? `รับของ ${saved.data.gr_no} แล้ว รอคุณจวงใส่ราคา`);
      });
    }}>
      <h2 className="font-semibold">หน้าร้านรับของ</h2>
      <div className="grid gap-2 md:grid-cols-2">
        <select className={field} name="receiving_branch_code" defaultValue={branches[0]?.branch_code}>{branches.map((branch) => <option key={branch.branch_code} value={branch.branch_code}>{branch.branch_code}</option>)}</select>
        <input className={field} name="staff_name" placeholder="ผู้รับของ" required />
        <input className={field} name="vendor_name" placeholder="ผู้ขาย" />
      </div>
      {lines.map((line, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-3">
          <select className={field} value={line.item_id} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, item_id: event.target.value } : row))}>
            {items.map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}
          </select>
          <input className={field} type="number" step="0.01" placeholder="จำนวน" value={line.qty} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row))} />
          <input className={field} placeholder="หน่วยที่รับ เช่น กล่อง/ถุง" value={line.uom} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, uom: event.target.value } : row))} />
        </div>
      ))}
      <button type="button" className="text-sm text-red-700" onClick={() => setLines((current) => [...current, { item_id: items[0]?.id ?? "", qty: "", uom: "" }])}>เพิ่มรายการ</button>
      <label className="block rounded-lg border border-dashed p-3 text-sm" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        รูปของที่มาส่ง
        <input className="mt-2 block w-full" name="photos" type="file" accept="image/*" capture="environment" multiple />
      </label>
      <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>บันทึกรับของ</button>
    </form>
  );
}

function HqMatch({
  branches,
  receipts,
  pending,
  start,
  setMessage,
}: {
  branches: FnbBranchOption[];
  receipts: FnbGoodsReceiptRow[];
  pending: boolean;
  start: (callback: () => void) => void;
  setMessage: (message: string) => void;
}) {
  const [grId, setGrId] = useState(receipts[0]?.id ?? "");
  const [lines, setLines] = useState<FnbGoodsReceiptLineRow[]>([]);
  const receipt = receipts.find((row) => row.id === grId);
  const branch = branches.find((row) => row.branch_code === receipt?.receiving_branch_code);
  const [taxBranch, setTaxBranch] = useState(receipt?.tax_invoice_branch_code ?? branch?.vat_branch_code ?? "00000");
  const mismatch = Boolean(taxBranch && branch?.vat_branch_code && taxBranch !== branch.vat_branch_code);
  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">ชนใบกำกับภาษี</h2>
      <select className={field} value={grId} onChange={(event) => {
        const next = event.target.value;
        setGrId(next);
        start(async () => {
          const listed = await listReceiptLinesAction(next);
          setLines(listed.data);
          setMessage(listed.error ?? "");
        });
      }}>
        {receipts.map((row) => <option key={row.id} value={row.id}>{row.gr_no} · {row.receiving_branch_code} · {row.doc_tax_status}</option>)}
      </select>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm">สาขาที่รับของจริง
          <select className={field} value={receipt?.receiving_branch_code ?? ""} disabled>{branches.map((row) => <option key={row.branch_code} value={row.branch_code}>{row.branch_code}</option>)}</select>
        </label>
        <label className="text-sm">เลขสาขาบนใบกำกับ
          <select className={field} value={taxBranch} onChange={(event) => setTaxBranch(event.target.value)}>
            <option value="00000">00000 สำนักงานใหญ่</option>
            <option value="00001">00001 หาดใหญ่</option>
            <option value="00002">00002 ม.อ.</option>
            <option value="00003">00003</option>
            <option value="00004">00004</option>
          </select>
        </label>
      </div>
      {mismatch ? <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">สาขารับของกับเลขบนใบกำกับไม่ตรงกัน ใช้ได้กับ ภ.พ.30 รวมของจัสมินพลัส และแยกบัญชี VAT รายสาขา</p> : null}
      {lines.map((line, index) => (
        <div key={line.id} className="grid gap-2 md:grid-cols-4">
          <p className="text-sm">{line.item_description} × {line.received_qty} {line.received_uom}</p>
          <input className={field} type="number" step="0.01" defaultValue={line.unit_price} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, unit_price: Number(event.target.value) || 0 } : row))} />
          <select className={field} value={line.line_vat_mode} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, line_vat_mode: event.target.value } : row))}>
            {FNB_VAT_MODES.map((mode) => <option key={mode}>{mode}</option>)}
          </select>
        </div>
      ))}
      <HqConfirm
        pending={pending}
        onConfirm={(extra) => {
          if (!receipt) return;
          start(async () => {
            const saved = await confirmHqGoodsReceiptAction({
              gr_id: receipt.id,
              receiving_branch_code: receipt.receiving_branch_code,
              tax_invoice_branch_code: taxBranch,
              vendor_name: extra.vendor,
              vendor_invoice_no: extra.invoice,
              doc_tax_status: extra.status,
              discount_coupon_amount: extra.discount,
              freight_amount: extra.freight,
              under_moq_surcharge: extra.surcharge,
              lines,
            });
            setMessage(saved.error ?? "ชนบิลและอัปเดตทุนเฉลี่ยแล้ว");
          });
        }}
      />
    </section>
  );
}

function HqConfirm({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: (extra: { vendor: string; invoice: string; status: string; discount: number; freight: number; surcharge: number }) => void;
}) {
  return (
    <form className="grid gap-2 md:grid-cols-3" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onConfirm({
        vendor: String(form.get("vendor") ?? ""),
        invoice: String(form.get("invoice") ?? ""),
        status: String(form.get("status") ?? "TAX_INVOICE_READY"),
        discount: Number(form.get("discount") ?? 0),
        freight: Number(form.get("freight") ?? 0),
        surcharge: Number(form.get("surcharge") ?? 0),
      });
    }}>
      <input className={field} name="vendor" placeholder="SUPER DAN / มาลี / แพนฟู้ด" />
      <input className={field} name="invoice" placeholder="เลขที่ใบกำกับ" />
      <select className={field} name="status">{FNB_DOC_TAX_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
      <input className={field} name="discount" type="number" step="0.01" placeholder="คูปอง เช่น CPN9 95" />
      <input className={field} name="freight" type="number" step="0.01" placeholder="ค่าขนส่ง" />
      <input className={field} name="surcharge" type="number" step="0.01" placeholder="ค่าไม่ถึงขั้นต่ำ" />
      <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>ยืนยันและลงสต็อก</button>
    </form>
  );
}

function PayoutQueue({
  payouts,
  pending,
  start,
  setMessage,
}: {
  payouts: FnbReimbursementRow[];
  pending: boolean;
  start: (callback: () => void) => void;
  setMessage: (message: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      body.set("ids", picked.join(","));
      start(async () => {
        const saved = await markReimbursementsPaidAction(body);
        setMessage(saved.error ?? `โอนแล้ว ${saved.data.paid} รายการ`);
      });
    }}>
      <h2 className="font-semibold">คิวโอนคืนคุณจวง</h2>
      {payouts.map((row) => (
        <label key={row.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={picked.includes(row.id)} onChange={(event) => setPicked((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} />
          {row.reimb_no} · {row.staff_name} · {row.reimb_mode} · {row.total_amount.toFixed(2)} · {row.payee_bank_info ?? ""}
        </label>
      ))}
      <label className="block text-sm" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        สลิปโอน 1 ใบสำหรับรายการที่เลือก
        <input className="mt-2 block" name="slip" type="file" accept="image/*" />
      </label>
      <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending || picked.length === 0}>ทำเครื่องหมายว่าโอนแล้ว</button>
    </form>
  );
}
