"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  generateTier12CashReceiptNumbersAction,
  getCashReceiptPackAction,
} from "@/app/actions/finance/cash-receipts";
import { CashReceiptPrintSet } from "@/components/finance/cash-receipt-print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { monthBounds, thaiMonthLabel, todayBillingIso } from "@/lib/utils/billing-period";
import type { CashReceiptBill } from "@/types/cash-receipt";

function recentMonths(count: number): string[] {
  const current = todayBillingIso().slice(0, 7);
  const [yearText, monthText] = current.split("-");
  let year = Number(yearText);
  let month = Number(monthText);
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

export function CashReceiptCenter() {
  const months = useMemo(() => recentMonths(4), []);
  const initial = monthBounds(todayBillingIso().slice(0, 7));
  const [fromDate, setFromDate] = useState(initial?.from ?? todayBillingIso());
  const [toDate, setToDate] = useState(initial?.to ?? todayBillingIso());
  const [periodKey, setPeriodKey] = useState(todayBillingIso().slice(0, 7));
  const [prefix, setPrefix] = useState("CA01");
  const [sellerMode, setSellerMode] = useState<"name" | "cash">("name");
  const [bills, setBills] = useState<CashReceiptBill[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function loadPack(): Promise<CashReceiptBill[] | null> {
    const result = await getCashReceiptPackAction(fromDate, toDate);
    if (result.error) {
      toast.error(result.error);
      return null;
    }
    setBills(result.bills);
    return result.bills;
  }

  async function generate() {
    setBusy("generate");
    try {
      const result = await generateTier12CashReceiptNumbersAction({ fromDate, toDate, prefix });
      if (!result.success) {
        toast.error(result.error ?? "สร้างเลขที่ใบรับเงินไม่สำเร็จ");
        return;
      }
      toast.success(`สร้างเลขที่ใบรับเงิน ${result.generatedCount} ใบ`);
      await loadPack();
    } finally {
      setBusy(null);
    }
  }

  async function download(format: "xlsx" | "csv") {
    setBusy(format);
    try {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
        format,
        seller: sellerMode,
      });
      const response = await fetch(`/api/finance/export-cash-receipts?${params.toString()}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "ส่งออกไฟล์ไม่สำเร็จ");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cash-receipts-${prefix}-${fromDate}_${toDate}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(format === "xlsx" ? "ดาวน์โหลด Excel แล้ว" : "ดาวน์โหลด CSV แล้ว");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "ส่งออกไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .cash-pack-print, .cash-pack-print * { visibility: visible; }
          .cash-pack-print { position: absolute; left: 0; top: 0; width: 100%; }
          .cash-receipt-sheet { break-before: page; page-break-before: always; }
        }
        @page { size: A4 portrait; margin: 12mm; }
      `}</style>
      <div className="print:hidden space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ชุดใบรับเงิน (กลุ่ม 1.2)</h1>
          <p className="text-sm text-slate-500">
            บิลซื้อไม่มี VAT ที่แนบบัตรประชาชน — รันเลข CA พิมพ์ชุดส่งสำนักงานบัญชี และส่งออก Excel/CSV
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {months.map((key) => {
            const bounds = monthBounds(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (!bounds) return;
                  setPeriodKey(key);
                  setFromDate(bounds.from);
                  setToDate(bounds.to);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  periodKey === key ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-white"
                }`}
              >
                {thaiMonthLabel(key)}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="ca-from">ตั้งแต่วันที่</Label>
            <Input id="ca-from" type="date" value={fromDate} onChange={(event) => { setPeriodKey("custom"); setFromDate(event.target.value); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ca-to">ถึงวันที่</Label>
            <Input id="ca-to" type="date" value={toDate} onChange={(event) => { setPeriodKey("custom"); setToDate(event.target.value); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ca-prefix">รหัสนำหน้าเลขที่ใบรับเงิน</Label>
            <Input id="ca-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1">
            <Label>ชื่อผู้ขายบนหน้าปก</Label>
            <select
              value={sellerMode}
              onChange={(event) => setSellerMode(event.target.value === "cash" ? "cash" : "name")}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="name">ชื่อร้านค้า</option>
              <option value="cash">ขายสด/ซื้อสด</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2 lg:grid-cols-4">
          <Button type="button" disabled={busy != null} onClick={() => void generate()}>
            {busy === "generate" ? "กำลังสร้างเลข..." : "⚡ 1. สร้างเลขที่ใบรับเงินอัตโนมัติ (CA01/0001...)"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy != null}
            onClick={() => {
              void loadPack().then((rows) => {
                if (rows) window.print();
              });
            }}
          >
            🖨️ 2. พิมพ์ชุดใบรับเงิน (ตารางปกรายงาน + ใบรับเงินรายใบ PDF)
          </Button>
          <Button type="button" variant="outline" disabled={busy != null} onClick={() => void download("xlsx")}>
            {busy === "xlsx" ? "กำลังส่งออก..." : "📊 3. ส่งออกไฟล์ Excel (.xlsx)"}
          </Button>
          <Button type="button" variant="outline" disabled={busy != null} onClick={() => void download("csv")}>
            {busy === "csv" ? "กำลังส่งออก..." : "📄 4. ส่งออกไฟล์ CSV (.csv)"}
          </Button>
        </div>
        <Button type="button" variant="outline" disabled={busy != null} onClick={() => void loadPack()}>
          แสดงรายการในงวด
        </Button>
        <p className="text-xs text-slate-500">พบ {bills.length} ใบในชุดที่โหลดล่าสุด</p>
      </div>
      <CashReceiptPrintSet bills={bills} sellerMode={sellerMode} />
    </div>
  );
}
