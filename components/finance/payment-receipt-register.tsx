"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getPaymentReceiptRegisterAction } from "@/app/actions/finance/payment-register";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { compactRepeatedBillLabel, formatRegisterBillLabel } from "@/lib/finance/payment-register-label";
import { ReplacePaymentSlipDialog } from "@/components/finance/replace-payment-slip-dialog";
import { monthBounds, thaiMonthLabel, todayBillingIso } from "@/lib/utils/billing-period";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { paymentTimeLabel } from "@/lib/utils/payment-timestamp";
import { cn } from "@/lib/utils";
import type {
  PaymentRegisterData,
  PaymentRegisterDirection,
  PaymentRegisterLine,
} from "@/types/payment-register";

function displayBillLabel(row: { lines: PaymentRegisterLine[]; billLabel: string }): string {
  const fromLines = row.lines.length > 0 ? formatRegisterBillLabel(row.lines, true) : "—";
  return fromLines !== "—" ? fromLines : compactRepeatedBillLabel(row.billLabel);
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

export function PaymentReceiptRegister() {
  const initial = monthBounds(todayBillingIso().slice(0, 7));
  const [direction, setDirection] = useState<PaymentRegisterDirection>("ALL");
  const [fromDate, setFromDate] = useState(initial?.from ?? todayBillingIso());
  const [toDate, setToDate] = useState(initial?.to ?? todayBillingIso());
  const [periodKey, setPeriodKey] = useState(todayBillingIso().slice(0, 7));
  const [channelId, setChannelId] = useState("");
  const [data, setData] = useState<PaymentRegisterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [replaceRow, setReplaceRow] = useState<PaymentRegisterData["rows"][number] | null>(null);
  const months = useMemo(() => recentMonths(4), []);

  async function load() {
    setLoading(true);
    try {
      const result = await getPaymentReceiptRegisterAction({
        direction,
        fromDate,
        toDate,
        channelId: channelId || null,
      });
      setData(result ?? { rows: [], banks: [], channels: [], error: null });
      if (result?.error) toast.error(result.error);
    } catch (err) {
      console.error(err);
      setData({ rows: [], banks: [], channels: [], error: null });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Load the current month once. Later changes wait for the filter button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        direction,
        from: fromDate,
        to: toDate,
      });
      if (channelId) params.set("channel", channelId);
      const response = await fetch(`/api/finance/export-payment-register?${params.toString()}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "ส่งออก Excel ไม่สำเร็จ");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `payment-register-${fromDate}_${toDate}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("ดาวน์โหลดสมุดทะเบียนรับ-จ่ายแล้ว");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "ส่งออก Excel ไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>📊 ประวัติการรับ-จ่ายเงิน & ส่งออก Excel ส่งสำนักงานบัญชี</CardTitle>
            <CardDescription>
              สมุดทะเบียนจ่ายคู่ค้า (PAY) และรับเงินลูกค้า (REC) พร้อมวันเวลาบนสลิป
            </CardDescription>
          </div>
          <Button type="button" onClick={() => void exportExcel()} disabled={exporting || loading}>
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            📥 ส่งออกตาราง Excel (.xlsx) ส่งสำนักงานบัญชี
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["ALL", "ทั้งหมด (รับ + จ่าย)"],
              ["AP", "📤 รายการจ่ายชำระหนี้คู่ค้า (AP Outbound)"],
              ["AR", "📥 รายการรับเงินลูกค้า (AR Inbound)"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDirection(value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                direction === value
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700",
              )}
            >
              {label}
            </button>
          ))}
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
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  periodKey === key
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-700",
                )}
              >
                {thaiMonthLabel(key)}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="register-from">ตั้งแต่วันที่</Label>
            <Input
              id="register-from"
              type="date"
              value={fromDate}
              onChange={(event) => {
                setPeriodKey("custom");
                setFromDate(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="register-to">ถึงวันที่</Label>
            <Input
              id="register-to"
              type="date"
              value={toDate}
              onChange={(event) => {
                setPeriodKey("custom");
                setToDate(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="register-channel">ช่องทางเงินสด/บัญชีธนาคาร</Label>
            <select
              id="register-channel"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">ทุกช่องทาง</option>
              <option value="CASH">เงินสด (Cash)</option>
              {(data?.banks ?? []).map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.bankName} • {bank.accountNo}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              แสดงรายการ
            </Button>
          </div>
        </div>

        {data?.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {data.error}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          {(data?.channels ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-slate-500">
              ยังไม่มียอดในช่วงนี้
            </div>
          ) : (
            data?.channels.map((channel) => (
              <div key={channel.key} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">{channel.label}</p>
                <p className="mt-1 text-xs text-emerald-700">รับเข้า ฿{formatMoney(channel.inbound)}</p>
                <p className="text-xs text-orange-700">จ่ายออก ฿{formatMoney(channel.outbound)}</p>
              </div>
            ))
          )}
        </div>

        <div className="overflow-x-auto rounded-md border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วัน-เวลาที่ชำระ</TableHead>
                <TableHead>ประเภทรายการ</TableHead>
                <TableHead>เลขที่เอกสาร</TableHead>
                <TableHead>ชื่อคู่ค้า / ลูกค้า</TableHead>
                <TableHead>ช่องทาง</TableHead>
                <TableHead>เลขที่ใบวางบิล / บิลที่ตัดชำระ</TableHead>
                <TableHead>เลขอ้างอิงสลิป/เช็ค</TableHead>
                <TableHead className="text-right">ยอดเงินสุทธิ (บาท)</TableHead>
                <TableHead>สลิปโอนเงิน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-16 text-center text-slate-500">
                    {loading ? "กำลังโหลด..." : "ไม่พบรายการในช่วงที่เลือก"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatThaiDate(row.paidAt, "short")} {paymentTimeLabel(row.paidAt)}
                    </TableCell>
                    <TableCell>{row.direction === "AP" ? "จ่ายคู่ค้า" : "รับเงินลูกค้า"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.docNo}</TableCell>
                    <TableCell>{row.contactName}</TableCell>
                    <TableCell>{row.channelLabel}</TableCell>
                    <TableCell className="max-w-md text-xs">{displayBillLabel(row)}</TableCell>
                    <TableCell>{row.referenceNo || "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(row.amount)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        {row.slipUrl ? (
                          <a
                            href={row.slipUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-blue-700 underline"
                          >
                            ดูสลิป
                          </a>
                        ) : (
                          <span>—</span>
                        )}
                        {row.voucherDocId ? (
                          <button
                            type="button"
                            onClick={() => setReplaceRow(row)}
                            className="text-xs font-semibold text-emerald-800 underline"
                          >
                            🔄 เปลี่ยนสลิป
                          </button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <ReplacePaymentSlipDialog
          open={replaceRow != null}
          onOpenChange={(next) => {
            if (!next) setReplaceRow(null);
          }}
          voucherDocId={replaceRow?.voucherDocId ?? ""}
          partyName={replaceRow?.contactName ?? "คู่ค้า"}
          netAmount={replaceRow?.amount ?? 0}
          onSaved={() => void load()}
        />
      </CardContent>
    </Card>
  );
}
