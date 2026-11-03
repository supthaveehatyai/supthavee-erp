"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  getAccountantReceiptFiles,
  markReceiptsSweptToCompany,
} from "@/lib/actions/finance/receipt-sweep-actions";
import type { UnsweptReceiptRow } from "@/lib/finance/payment-channel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBase64(filename: string, base64: string, mime: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function UnsweptReceiptsCard({
  rows,
  error,
}: {
  rows: UnsweptReceiptRow[];
  error?: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sweptOn, setSweptOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [batchRef, setBatchRef] = useState("");
  const [isPending, startTransition] = useTransition();

  const cashTotal = useMemo(
    () =>
      rows
        .filter((row) => row.payment_channel === "CASH")
        .reduce((sum, row) => sum + row.amount, 0),
    [rows],
  );
  const otherTotal = useMemo(
    () =>
      rows
        .filter((row) => row.payment_channel === "OTHER_BANK")
        .reduce((sum, row) => sum + row.amount, 0),
    [rows],
  );
  const selectedIds = rows.filter((row) => selected[row.id]).map((row) => row.id);

  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {};
    if (checked) {
      for (const row of rows) next[row.id] = true;
    }
    setSelected(next);
  }

  function confirmSweep() {
    if (selectedIds.length === 0) {
      toast.error("กรุณาติ๊กเลือกรายการที่จะโอนรวม");
      return;
    }
    startTransition(async () => {
      const result = await markReceiptsSweptToCompany({
        document_ids: selectedIds,
        swept_on: sweptOn,
        swept_batch_ref: batchRef,
      });
      if (!result.success) {
        toast.error(result.error ?? "บันทึกการโอนรวมไม่สำเร็จ");
        return;
      }
      toast.success(`บันทึกโอนรวมแล้ว ${result.updated} รายการ`);
      setSelected({});
      setBatchRef("");
      router.refresh();
    });
  }

  function exportReport(kind: "csv" | "xlsx") {
    startTransition(async () => {
      const result = await getAccountantReceiptFiles();
      if (result.error || !result.csv || !result.xlsx_base64) {
        toast.error(result.error ?? "ส่งออกรายงานไม่สำเร็จ");
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "csv") {
        downloadText(
          `receipt-register-${stamp}.csv`,
          result.csv,
          "text/csv;charset=utf-8",
        );
      } else {
        downloadBase64(
          `receipt-register-${stamp}.xlsx`,
          result.xlsx_base64,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      }
      toast.success(kind === "csv" ? "ดาวน์โหลด CSV แล้ว" : "ดาวน์โหลด Excel แล้ว");
    });
  }

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">
            🔄 สรุปยอดเงินสด + บัญชีอื่น รอโอนเข้าบัญชีบริษัท
          </CardTitle>
          <CardDescription>
            DEP_IN, CS_TAX, ABB, TAX_INV และ INV_DO ที่ยังไม่โอนเข้าบัญชีบริษัท
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => exportReport("csv")}
          >
            📊 Export รายงานรับเงิน (.csv)
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => exportReport("xlsx")}
          >
            📊 Export รายงานรับเงิน (.xlsx)
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : (
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <p>เงินสดหน้าร้าน: ฿{formatMoney(cashTotal)}</p>
            <p>บัญชีอื่น: ฿{formatMoney(otherTotal)}</p>
            <p className="font-semibold text-amber-950">
              รวมยอดที่ต้องโอนเข้าบัญชีบริษัท: ฿{formatMoney(cashTotal + otherTotal)}
            </p>
          </div>
        )}
        {rows.length > 0 ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={selectedIds.length === rows.length}
                onChange={(event) => toggleAll(event.target.checked)}
              />
              เลือกทั้งหมด {rows.length} รายการ
            </label>
            <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-amber-100 bg-white p-2">
              {rows.map((row) => (
                <label key={row.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[row.id])}
                    onChange={(event) =>
                      setSelected((current) => ({
                        ...current,
                        [row.id]: event.target.checked,
                      }))
                    }
                  />
                  <span className="font-mono text-xs">{row.doc_no}</span>
                  <span className="text-slate-500">{row.doc_date}</span>
                  <span>{row.contact_name}</span>
                  <span className="ml-auto tabular-nums">
                    ฿{formatMoney(row.amount)}
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="swept-on">วันที่โอนเข้าบัญชีบริษัท</Label>
                <Input
                  id="swept-on"
                  type="date"
                  value={sweptOn}
                  onChange={(event) => setSweptOn(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="swept-ref">เลขอ้างอิงสลิปโอนรวม</Label>
                <Input
                  id="swept-ref"
                  value={batchRef}
                  onChange={(event) => setBatchRef(event.target.value)}
                  placeholder="เลขสลิปโอนเข้า KTB"
                />
              </div>
              <Button
                type="button"
                disabled={isPending}
                className="bg-emerald-700 hover:bg-emerald-800"
                onClick={confirmSweep}
              >
                ✅ บันทึกโอนรวมเข้าบัญชีบริษัทแล้ว
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">ไม่มีรายการเงินสดหรือบัญชีอื่นที่รอโอน</p>
        )}
      </CardContent>
    </Card>
  );
}
