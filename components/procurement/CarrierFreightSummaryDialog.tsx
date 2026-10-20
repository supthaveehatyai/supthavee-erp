"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  confirmCarrierReceipt,
  listDestFreightSummary,
} from "@/lib/actions/carrier-actions";
import type { CarrierOption, DestFreightSummaryRow } from "@/types/carrier";
import { CarrierOptionGroups } from "@/components/procurement/DualFreightFields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function CarrierFreightSummaryDialog({
  open,
  onOpenChange,
  carriers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carriers: CarrierOption[];
}) {
  const [carrierId, setCarrierId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<DestFreightSummaryRow[]>([]);
  const [totalFreight, setTotalFreight] = useState(0);
  const [totalWht, setTotalWht] = useState(0);
  const [loading, setLoading] = useState(false);
  const [receiptNo, setReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void listDestFreightSummary({
      carrierId,
      dateFrom,
      dateTo,
      receiptStatus: status,
    }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.error) {
        toast.error(result.error);
        setRows([]);
        setTotalFreight(0);
        setTotalWht(0);
        return;
      }
      setRows(result.data);
      setTotalFreight(result.totalFreight);
      setTotalWht(result.totalWht);
    });
    return () => {
      cancelled = true;
    };
  }, [open, carrierId, dateFrom, dateTo, status]);

  async function handleConfirm(row: DestFreightSummaryRow) {
    if (!receiptNo.trim() || !receiptDate) {
      toast.error("กรอกเลขที่ใบเสร็จและวันที่ก่อนยืนยัน");
      return;
    }
    setSavingId(row.document_id);
    const result = await confirmCarrierReceipt({
      documentId: row.document_id,
      receiptNo,
      receiptDate,
    });
    setSavingId(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`บันทึกใบเสร็จ ${receiptNo.trim()} แล้ว`);
    setRows((current) =>
      current.map((item) =>
        item.document_id === row.document_id
          ? {
              ...item,
              carrier_receipt_status: "RECEIVED",
              carrier_receipt_no: receiptNo.trim(),
              carrier_receipt_date: receiptDate,
            }
          : item,
      ),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>สรุปค่าขนส่งปลายทาง (ขอใบเสร็จ)</DialogTitle>
          <DialogDescription>
            รวมยอดที่จ่ายบริษัทขนส่งแยกจากหนี้ผู้ขายสินค้า เพื่อขอใบเสร็จและหัก ณ ที่จ่าย
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <Label htmlFor="freight-summary-carrier">บริษัทขนส่ง</Label>
            <Select
              id="freight-summary-carrier"
              value={carrierId}
              onChange={(event) => setCarrierId(event.target.value)}
              className="mt-1 h-9"
            >
              <option value="">ทุกเจ้า</option>
              <CarrierOptionGroups carriers={carriers} />
            </Select>
          </div>
          <div>
            <Label htmlFor="freight-summary-from">ตั้งแต่วันที่</Label>
            <Input
              id="freight-summary-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="freight-summary-to">ถึงวันที่</Label>
            <Input
              id="freight-summary-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="freight-summary-status">สถานะใบเสร็จ</Label>
            <Select
              id="freight-summary-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-1 h-9"
            >
              <option value="">ทั้งหมด</option>
              <option value="PENDING">PENDING = รอขอใบเสร็จ</option>
              <option value="RECEIVED">RECEIVED = ได้รับใบเสร็จแล้ว</option>
            </Select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-slate-500">ยอดค่าขนส่งปลายทาง</p>
            <p className="text-lg font-bold tabular-nums">฿{formatMoney(totalFreight)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-slate-500">ยอดหัก ณ ที่จ่าย 1%</p>
            <p className="text-lg font-bold tabular-nums">฿{formatMoney(totalWht)}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <Input
            value={receiptNo}
            onChange={(event) => setReceiptNo(event.target.value)}
            placeholder="เลขที่ใบเสร็จรับเงินขนส่ง"
          />
          <Input
            type="date"
            value={receiptDate}
            onChange={(event) => setReceiptDate(event.target.value)}
          />
        </div>

        <div className="mt-3 space-y-2">
          {loading ? <p className="text-sm text-slate-500">กำลังโหลด...</p> : null}
          {!loading && rows.length === 0 ? (
            <p className="text-sm text-slate-500">ไม่พบเอกสารที่มีค่าขนส่งปลายทางตามตัวกรอง</p>
          ) : null}
          {rows.map((row) => (
            <div
              key={row.document_id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {row.doc_no} · {row.carrier_name}
                </p>
                <p className="text-xs text-slate-500">
                  {row.doc_date}
                  {row.vendor_name ? ` · ผู้ขาย ${row.vendor_name}` : ""}
                  {row.carrier_tax_id ? ` · เลขผู้เสียภาษี ${row.carrier_tax_id}` : ""}
                  {row.carrier_branch_code ? ` · สาขา ${row.carrier_branch_code}` : ""}
                  {row.carrier_tracking_no ? ` · พัสดุ ${row.carrier_tracking_no}` : ""}
                  {" · หัก ณ ที่จ่าย 1% ฿"}
                  {formatMoney(row.estimated_wht_1pct)}
                  {" · "}
                  {row.carrier_receipt_status === "RECEIVED"
                    ? `RECEIVED ${row.carrier_receipt_no ?? ""}`
                    : "PENDING รอขอใบเสร็จ"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <p className="font-bold tabular-nums">฿{formatMoney(row.dest_freight_cost)}</p>
                {row.carrier_receipt_status !== "RECEIVED" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingId === row.document_id}
                    onClick={() => void handleConfirm(row)}
                  >
                    บันทึกเลขที่ใบเสร็จรับเงินขนส่ง
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
