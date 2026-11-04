"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  autoMatchUniqueDeposits,
  confirmBankMatch,
  confirmWithdrawalRecord,
  importKtbStatement,
  listBankStatementLines,
  reclassifyDocumentPaymentChannel,
  searchOpenPurchaseBills,
  searchOpenSalesBills,
  suggestBillMatches,
  unmatchBankStatementLine,
} from "@/lib/actions/bank-reconcile-actions";
import { formatShortDateTh } from "@/lib/utils/date-formatter";
import { cn } from "@/lib/utils";
import type {
  BankStatementLineView,
  BillMatchSuggestion,
  OpenSalesBill,
} from "@/types/bank-reconcile";
import { Button } from "@/components/ui/button";

const ACCEPT =
  ".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/pdf,image/jpeg,image/png,image/webp";

function money(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

type LineScope = "deposits" | "withdrawals" | "all";

function isWithdrawal(line: BankStatementLineView): boolean {
  return line.withdrawal_amount > 0.05 && line.deposit_amount <= 0.05;
}

function issuedTime(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function billCaption(bill: OpenSalesBill): string {
  const time = issuedTime(bill.created_at);
  const when = `${formatShortDateTh(bill.doc_date)}${time ? ` (เวลา ${time})` : ""}`;
  const slip = bill.reference_no ? ` · สลิป ${bill.reference_no}` : "";
  const customer = bill.customer_label ? ` · ${bill.customer_label}` : "";
  const deposit =
    bill.deposit_deducted > 0.05 &&
    (bill.doc_type === "SO" || bill.doc_type === "INV_DO" || bill.doc_type === "TAX_INV")
      ? ` (ยอดเต็ม ${money(bill.grand_total)} หักมัดจำ ${money(bill.deposit_deducted)})`
      : "";
  return `${bill.doc_no} · ${when}${slip}${customer} · ตัดได้ ${money(bill.linkable_amount)}${deposit}`;
}

export default function BankReconcileWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [scope, setScope] = useState<LineScope>("deposits");
  const [lines, setLines] = useState<BankStatementLineView[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<BillMatchSuggestion[]>([]);
  const [bills, setBills] = useState<OpenSalesBill[]>([]);
  const [keyword, setKeyword] = useState("");
  const [channel, setChannel] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [fee, setFee] = useState(0);
  const [expenseMemo, setExpenseMemo] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  const selected = lines.find((line) => line.id === selectedId) ?? null;
  const paying = selected ? isWithdrawal(selected) : false;
  const movement = selected
    ? paying
      ? selected.withdrawal_amount
      : selected.deposit_amount
    : 0;
  const room = selected ? roundMoney(Math.max(0, movement - selected.matched_amount)) : 0;
  const totals = useMemo(() => {
    const received = roundMoney(
      lines.reduce((sum, line) => sum + (line.deposit_amount > 0 ? line.deposit_amount : 0), 0),
    );
    const paid = roundMoney(
      lines.reduce(
        (sum, line) => sum + (line.withdrawal_amount > 0 ? line.withdrawal_amount : 0),
        0,
      ),
    );
    return { received, paid };
  }, [lines]);
  const pickedBills = useMemo(
    () => bills.filter((bill) => picked[bill.id]),
    [bills, picked],
  );
  const pickedTotal = roundMoney(
    pickedBills.reduce((sum, bill) => sum + bill.linkable_amount, 0),
  );
  const cash = roundMoney(pickedTotal - fee);
  const canConfirm =
    Boolean(selected) &&
    room > 0.05 &&
    pickedBills.length > 0 &&
    cash > 0 &&
    cash <= room + 0.05;

  useEffect(() => {
    const preventBrowserFileOpen = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener("dragover", preventBrowserFileOpen);
    window.addEventListener("drop", preventBrowserFileOpen);
    return () => {
      window.removeEventListener("dragover", preventBrowserFileOpen);
      window.removeEventListener("drop", preventBrowserFileOpen);
    };
  }, []);

  useEffect(() => {
    void loadLines(scope);
  }, [scope]);

  useEffect(() => {
    setFee(roundMoney(Math.max(0, pickedTotal - room)));
  }, [pickedTotal, room]);

  async function loadLines(nextScope: LineScope) {
    const result = await listBankStatementLines(nextScope);
    setLines(result.data);
    setListError(result.error);
  }

  async function loadMatch(line: BankStatementLineView) {
    setSelectedId(line.id);
    setPicked({});
    setSuggestions([]);
    setBills([]);
    const hint = /[ก-๙]/.test(line.payer_hint) ? line.payer_hint : "";
    setKeyword(hint);
    setExpenseMemo(line.expense_memo ?? "");
    setIsWorking(true);
    try {
      if (isWithdrawal(line)) {
        const found = await searchOpenPurchaseBills({
          keyword: hint,
          tx_date: line.tx_date,
        });
        if (found.error) toast.error(found.error);
        setSuggestions([]);
        setBills(found.data);
        return;
      }
      const [suggested, found] = await Promise.all([
        suggestBillMatches(line.id),
        searchOpenSalesBills({
          keyword: hint,
          tx_date: line.tx_date,
          sales_channel: channel || null,
          description: line.description,
        }),
      ]);
      if (suggested.error) toast.error(suggested.error);
      if (found.error) toast.error(found.error);
      setSuggestions(suggested.data);
      setBills(found.data);
    } finally {
      setIsWorking(false);
    }
  }

  async function importFile(file: File | null | undefined) {
    if (!file || file.size <= 0) {
      toast.error("กรุณาเลือกไฟล์ Statement");
      return;
    }
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await importKtbStatement(formData);
      if (result.error || !result.data) {
        toast.error(result.error ?? "นำเข้า Statement ไม่สำเร็จ");
        return;
      }
      toast.success(
        `นำเข้า ${result.data.inserted} รายการ ข้ามของเดิม ${result.data.skipped} รายการ`,
      );
      await loadLines(scope);
    } finally {
      setIsImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function allowDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function confirmSuggestion(suggestion: BillMatchSuggestion) {
    if (!selected) return;
    setIsWorking(true);
    try {
      const result = await confirmBankMatch({
        statement_line_id: selected.id,
        allocations: [
          {
            document_id: suggestion.id,
            allocated_amount: suggestion.suggested_amount,
          },
        ],
        platform_fee_diff: suggestion.suggested_fee,
      });
      if (result.error || !result.data) {
        toast.error(result.error ?? "ยืนยันการชนยอดไม่สำเร็จ");
        return;
      }
      toast.success(`ชนยอดแล้ว สถานะ ${result.data.reconcile_status}`);
      for (const warning of result.data.warnings) toast.warning(warning);
      setSelectedId(null);
      await loadLines(scope);
    } finally {
      setIsWorking(false);
    }
  }

  async function confirmWithdrawal() {
    if (!selected || !paying) return;
    setIsWorking(true);
    try {
      const result = await confirmWithdrawalRecord({
        statement_line_id: selected.id,
        allocations: pickedBills.map((bill) => ({
          document_id: bill.id,
          allocated_amount: bill.linkable_amount,
        })),
        expense_memo: expenseMemo,
      });
      if (result.error || !result.data) {
        toast.error(result.error ?? "บันทึกยอดจ่ายไม่สำเร็จ");
        return;
      }
      toast.success(`บันทึกยอดจ่ายแล้ว สถานะ ${result.data.reconcile_status}`);
      setSelectedId(null);
      setPicked({});
      setExpenseMemo("");
      await loadLines(scope);
    } finally {
      setIsWorking(false);
    }
  }

  async function confirmPicked() {
    if (!selected || paying || !canConfirm) return;
    setIsWorking(true);
    try {
      const result = await confirmBankMatch({
        statement_line_id: selected.id,
        allocations: pickedBills.map((bill) => ({
          document_id: bill.id,
          allocated_amount: bill.linkable_amount,
        })),
        platform_fee_diff: fee,
      });
      if (result.error || !result.data) {
        toast.error(result.error ?? "ยืนยันการชนยอดไม่สำเร็จ");
        return;
      }
      toast.success(`ชนยอดแล้ว สถานะ ${result.data.reconcile_status}`);
      for (const warning of result.data.warnings) toast.warning(warning);
      setSelectedId(null);
      setPicked({});
      await loadLines(scope);
    } finally {
      setIsWorking(false);
    }
  }

  async function runAutoMatch() {
    setIsWorking(true);
    try {
      const result = await autoMatchUniqueDeposits();
      if (result.error || !result.data) {
        toast.error(result.error ?? "ชนยอดอัตโนมัติไม่สำเร็จ");
        return;
      }
      toast.success(
        `ชนยอดอัตโนมัติ ${result.data.matched} คู่ · ข้ามยอดซ้ำหรือไม่ตรง ${result.data.skipped} รายการ`,
      );
      for (const warning of result.data.errors) toast.warning(warning);
      setSelectedId(null);
      await loadLines(scope);
    } finally {
      setIsWorking(false);
    }
  }

  async function reclassifyBill(documentId: string, paymentChannel: "CASH" | "OTHER_BANK") {
    setIsWorking(true);
    try {
      const result = await reclassifyDocumentPaymentChannel({
        document_id: documentId,
        payment_channel: paymentChannel,
      });
      if (result.error || !result.data) {
        toast.error(result.error ?? "ย้ายช่องทางรับเงินไม่สำเร็จ");
        return;
      }
      toast.success(
        paymentChannel === "CASH"
          ? "ย้ายไปเงินสดหน้าร้าน รอโอนเข้าบัญชีบริษัทแล้ว"
          : "ย้ายไปบัญชีอื่น รอโอนเข้าบัญชีบริษัทแล้ว",
      );
      setBills((current) => current.filter((bill) => bill.id !== documentId));
      setSuggestions((current) => current.filter((bill) => bill.id !== documentId));
      setPicked((current) => ({ ...current, [documentId]: false }));
    } finally {
      setIsWorking(false);
    }
  }

  async function unmatchSelected() {
    if (!selected || selected.reconcile_status !== "MATCHED") return;
    setIsWorking(true);
    try {
      const result = await unmatchBankStatementLine(selected.id);
      if (result.error || !result.data) {
        toast.error(result.error ?? "ยกเลิกการชนยอดไม่สำเร็จ");
        return;
      }
      toast.success("ยกเลิกการชนยอดแล้ว");
      setSelectedId(null);
      setPicked({});
      await loadLines(scope);
    } finally {
      setIsWorking(false);
    }
  }

  const duplicateWarnings = useMemo(() => {
    const seen = new Set<string>();
    const warnings: { date: string; amount: number; count: number }[] = [];
    for (const bill of bills) {
      if (bill.same_amount_count <= 1) continue;
      const key = `${bill.doc_date}|${bill.linkable_amount.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({
        date: bill.doc_date,
        amount: bill.linkable_amount,
        count: bill.same_amount_count,
      });
    }
    return warnings;
  }, [bills]);

  async function runSearch() {
    if (!selected) return;
    setIsWorking(true);
    try {
      const found = paying
        ? await searchOpenPurchaseBills({ keyword, tx_date: selected.tx_date })
        : await searchOpenSalesBills({
            keyword,
            tx_date: selected.tx_date,
            sales_channel: channel || null,
            description: selected.description,
          });
      if (found.error) toast.error(found.error);
      setBills(found.data);
      setPicked({});
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-xl bg-sky-50 text-sky-700">
          <Landmark className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            ชนยอด Statement ธนาคารกรุงไทย
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            นำเข้าไฟล์เดินบัญชีแล้วจับคู่เงินฝากกับบิลขาย INV_DO, TAX_INV, CS_TAX และ ABB
          </p>
        </div>
      </div>

      <label
        htmlFor="ktb-statement-file"
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition",
          isDragging
            ? "border-sky-500 bg-sky-50 ring-2 ring-sky-200"
            : "border-slate-300 bg-white hover:border-sky-400",
          isImporting && "pointer-events-none opacity-70",
        )}
        onDragEnter={(event) => {
          allowDrop(event);
          dragDepth.current += 1;
          setIsDragging(true);
        }}
        onDragOver={allowDrop}
        onDragLeave={(event) => {
          allowDrop(event);
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDragging(false);
        }}
        onDrop={(event) => {
          allowDrop(event);
          dragDepth.current = 0;
          setIsDragging(false);
          void importFile(event.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          id="ktb-statement-file"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={isImporting}
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
          }}
        />
        {isImporting ? (
          <Loader2 className="size-5 animate-spin text-sky-700" />
        ) : (
          <Landmark className="size-5 text-sky-700" />
        )}
        <span className="text-sm font-semibold text-slate-900">
          ลากไฟล์ Statement กรุงไทยมาวาง
        </span>
        <span className="text-xs text-slate-500">
          .xlsx .xls .csv .pdf หรือรูปสลิป — ไฟล์ .xls ที่ล็อกรหัสใช้เลขผู้เสียภาษี 0905564000520
        </span>
      </label>

      {listError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {listError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">รายการเดินบัญชี</h2>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["deposits", "🟢 เงินฝากรอชน"],
                  ["withdrawals", "🔴 รายการจ่าย/ถอนเงิน"],
                  ["all", "📋 ทั้งหมด (รับ + จ่าย)"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium",
                    scope === value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-8 w-fit px-3 text-xs"
              disabled={isWorking}
              onClick={() => void runAutoMatch()}
            >
              {isWorking ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
              ⚡ ชนยอดอัตโนมัติ (เฉพาะคู่ที่ยอดตรง 1-ต่อ-1 ไม่ซ้ำ)
            </Button>
            {scope === "all" ? (
              <p className="text-xs text-slate-600">
                ยอดรวมรับ{" "}
                <span className="font-semibold text-emerald-600">+{money(totals.received)}</span>
                {" · "}ยอดรวมจ่าย{" "}
                <span className="font-semibold text-rose-600">-{money(totals.paid)}</span>
              </p>
            ) : null}
          </div>
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">วันที่</th>
                  <th className="px-3 py-2">รายการ</th>
                  <th className="px-3 py-2 text-right">ยอดเงิน (รับ / จ่าย)</th>
                  <th className="px-3 py-2">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                      ยังไม่มีรายการ
                    </td>
                  </tr>
                ) : (
                  lines.map((line) => (
                    <tr
                      key={line.id}
                      className={cn(
                        "cursor-pointer border-t border-slate-100",
                        selectedId === line.id && "bg-sky-50",
                      )}
                      onClick={() => {
                        void loadMatch(line);
                      }}
                    >
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatShortDateTh(line.tx_date)}
                        <div className="text-[11px] text-slate-400">{line.tx_time}</div>
                      </td>
                      <td className="max-w-[240px] px-3 py-2">
                        <div className="truncate">{line.description || "—"}</div>
                        <div className="truncate text-[11px] text-slate-400">
                          {line.payer_hint || line.tx_code}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {isWithdrawal(line) ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
                              ถอน/จ่าย
                            </span>
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-600">
                              -{money(line.withdrawal_amount)}
                            </span>
                          </span>
                        ) : line.deposit_amount > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                              รับโอน
                            </span>
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-600">
                              +{money(line.deposit_amount)}
                            </span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {line.reconcile_status}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          {!selected ? (
            <p className="py-10 text-center text-sm text-slate-400">
              เลือกรายการเงินฝากเพื่อจับคู่บิล
            </p>
          ) : (
            <>
              {selected.reconcile_status === "MATCHED" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-amber-300 text-amber-800 hover:bg-amber-50"
                  disabled={isWorking}
                  onClick={() => void unmatchSelected()}
                >
                  🔄 ยกเลิกการชนยอด (Unmatch)
                </Button>
              ) : null}
              <div>
                <h2 className={cn("text-sm font-semibold", paying ? "text-rose-700" : "text-slate-800")}>
                  {paying
                    ? `🔴 ชนยอดรายการจ่าย / ถอนเงิน (-${money(selected.withdrawal_amount)} บาท)`
                    : `เงินฝากคงเหลือ ${money(room)} บาท`}
                </h2>
                <p className="text-xs text-slate-500">
                  {paying
                    ? `ยอดจ่าย ${money(selected.withdrawal_amount)} · บันทึกแล้ว ${money(selected.matched_amount)}`
                    : `ยอดฝาก ${money(selected.deposit_amount)} · ชนแล้ว ${money(selected.matched_amount)}`}
                </p>
              </div>

              {!paying && suggestions.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-600">บิลที่ระบบแนะนำ</p>
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl border px-3 py-2",
                        suggestion.same_amount_count > 1
                          ? "border-amber-200 bg-amber-50"
                          : "border-emerald-100 bg-emerald-50/60",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{suggestion.doc_no}</div>
                        <div className="truncate text-[11px] text-slate-500">
                          {suggestion.reason} · {billCaption(suggestion)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={isWorking}
                        onClick={() => {
                          void confirmSuggestion(suggestion);
                        }}
                      >
                        ยืนยัน
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder={paying ? "เลขเอกสาร / ชื่อเจ้าหนี้" : "เลขบิล / ชื่อลูกค้า / ชื่อเล่น"}
                  className="h-10 rounded-md border border-slate-200 px-3 text-sm"
                />
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  disabled={paying}
                  className="h-10 rounded-md border border-slate-200 px-2 text-sm disabled:bg-slate-50"
                >
                  <option value="">ทุกช่องทาง</option>
                  <option value="SHOPEE">Shopee</option>
                  <option value="LAZADA">Lazada</option>
                  <option value="STORE">หน้าร้าน / ทั่วไป</option>
                </select>
                <Button variant="outline" disabled={isWorking} onClick={() => void runSearch()}>
                  ค้นหาบิล
                </Button>
              </div>

              {!paying && duplicateWarnings.length > 0 ? (
                <div className="space-y-1">
                  {duplicateWarnings.map((warning) => (
                    <p
                      key={`${warning.date}-${warning.amount}`}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
                    >
                      ⚠️ มียอด {money(warning.amount)} ซ้ำกัน {warning.count} บิลในวันนี้ — แนะนำเรียงตามเวลา/เลขสลิป
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="max-h-72 overflow-auto rounded-xl border border-slate-100">
                {bills.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-slate-400">ไม่พบบิลที่ยังตัดได้</p>
                ) : (
                  bills.map((bill) => (
                    <div
                      key={bill.id}
                      className="flex items-start gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={Boolean(picked[bill.id])}
                        onChange={(event) => {
                          setPicked((current) => ({
                            ...current,
                            [bill.id]: event.target.checked,
                          }));
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-5 text-slate-800">
                          {billCaption(bill)}
                        </span>
                        {!paying ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            <button
                              type="button"
                              className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                              disabled={isWorking}
                              onClick={() => void reclassifyBill(bill.id, "CASH")}
                            >
                              💵 เปลี่ยนเป็นเงินสด
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                              disabled={isWorking}
                              onClick={() => void reclassifyBill(bill.id, "OTHER_BANK")}
                            >
                              📱 ย้ายไปบัญชีอื่น
                            </button>
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {paying ? (
                <label className="block text-sm text-slate-700">
                  📝 บันทึกช่วยจำรายจ่าย (กรณีไม่มีบิลในระบบ / ค่าใช้จ่ายทั่วไป)
                  <textarea
                    rows={2}
                    value={expenseMemo}
                    onChange={(event) => setExpenseMemo(event.target.value)}
                    placeholder="เช่น ค่าเสื้อ บจก.ทวีทรัพย์อาภรณ์ หรือ ค่าขนส่ง LLT"
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2"
                  />
                </label>
              ) : null}
              {!paying ? (
              <label className="block text-sm text-slate-700">
                ส่วนต่างค่าธรรมเนียมแพลตฟอร์ม / หัก ณ ที่จ่าย
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={Number.isFinite(fee) ? fee : 0}
                  onChange={(event) => setFee(roundMoney(Number(event.target.value) || 0))}
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3"
                />
              </label>
              ) : null}
              {!paying ? (
              <p className="text-xs text-slate-500">
                รวมบิล {money(pickedTotal)} − ส่วนต่าง {money(fee)} = เงินสด {money(cash)}
              </p>
              ) : null}
              {paying ? (
                <Button
                  disabled={
                    isWorking ||
                    selected.reconcile_status === "MATCHED" ||
                    (pickedBills.length === 0 && expenseMemo.trim().length === 0)
                  }
                  onClick={() => void confirmWithdrawal()}
                >
                  {isWorking ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  ยืนยันบันทึกยอดจ่าย
                </Button>
              ) : (
              <Button disabled={!canConfirm || isWorking} onClick={() => void confirmPicked()}>
                {isWorking ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                ยืนยันการชนยอด
              </Button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
