"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import {
  issueImportedEcommerceOrders,
  previewEcommerceOrders,
} from "@/lib/actions/sales-ocr-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { EcommerceChannel, EcommerceOrderDraft } from "@/types/sales-ocr";

const ACCEPT =
  ".xlsx,.csv,.jpg,.jpeg,.png,.webp,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,image/jpeg,image/png,image/webp,application/pdf";

type EcommerceOrderImporterProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  onFillForm: (order: EcommerceOrderDraft) => void;
};

function money(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function EcommerceOrderImporter({
  open,
  onOpenChange,
  disabled = false,
  onFillForm,
}: EcommerceOrderImporterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [channel, setChannel] = useState<"" | EcommerceChannel>("");
  const [orders, setOrders] = useState<EcommerceOrderDraft[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedOrders = useMemo(
    () => orders.filter((order) => selected[order.ecommerce_order_no]),
    [orders, selected],
  );
  const busy = disabled || isReading || isIssuing;

  function allowDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function resetPreview() {
    setOrders([]);
    setSelected({});
  }

  async function readFile(file: File | null | undefined) {
    if (!file || file.size <= 0) {
      toast.error("กรุณาเลือกไฟล์ออเดอร์");
      return;
    }
    setIsReading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      if (channel) formData.set("channel", channel);
      const result = await previewEcommerceOrders(formData);
      if (result.error || !result.data) {
        toast.error(result.error ?? "อ่านไฟล์ออเดอร์ไม่สำเร็จ");
        return;
      }
      setOrders(result.data);
      const next: Record<string, boolean> = {};
      for (const order of result.data) {
        next[order.ecommerce_order_no] = !order.duplicate_doc_no;
      }
      setSelected(next);
      if (result.detected_channel) setChannel(result.detected_channel);
      const duplicates = result.data.filter((order) => order.duplicate_doc_no).length;
      toast.success(
        duplicates > 0
          ? `พบ ${result.data.length} ออเดอร์ — ${duplicates} ใบออกบิลไปแล้ว`
          : `พบ ${result.data.length} ออเดอร์`,
      );
    } finally {
      setIsReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    allowDrop(event);
    dragDepth.current = 0;
    setIsDragging(false);
    if (busy) return;
    await readFile(event.dataTransfer.files?.[0]);
  }

  async function issueSelected() {
    const queue = selectedOrders.filter((order) => !order.duplicate_doc_no);
    if (queue.length === 0) {
      toast.error("เลือกออเดอร์ที่ยังไม่ได้ออกบิลอย่างน้อย 1 รายการ");
      return;
    }
    setIsIssuing(true);
    try {
      const result = await issueImportedEcommerceOrders(queue);
      if (result.error || !result.data) {
        toast.error(result.error ?? "ออกบิลไม่สำเร็จ");
        return;
      }
      const { issued, skipped, failed } = result.data;
      if (issued.length > 0) {
        toast.success(
          `ออกบิลแล้ว ${issued.length} ใบ: ${issued.map((row) => row.doc_no).join(", ")}`,
        );
      }
      if (skipped.length > 0) toast.warning(`ข้ามบิลซ้ำ ${skipped.length} รายการ`);
      for (const row of failed) toast.error(`${row.order_no}: ${row.error}`);
      if (failed.length === 0) onOpenChange(false);
    } finally {
      setIsIssuing(false);
    }
  }

  function fillSelected() {
    if (selectedOrders.length !== 1) {
      toast.error("เติมลงฟอร์มได้ครั้งละ 1 ออเดอร์");
      return;
    }
    const order = selectedOrders[0];
    if (order.duplicate_doc_no) {
      toast.warning(`เลขนี้มีบิล ${order.duplicate_doc_no} แล้ว — ตรวจก่อนบันทึก`);
    }
    onFillForm(order);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetPreview();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>🛒 นำเข้าออเดอร์ Shopee / Lazada</DialogTitle>
          <DialogDescription>
            อัปโหลด Excel/CSV จาก Seller Centre หรือรูปแคปหน้าจอ/ใบปะหน้า
            ระบบตรวจเลขคำสั่งซื้อซ้ำก่อนออกบิล ABB
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block space-y-1 text-sm text-slate-700">
            ช่องทางขาย
            <select
              value={channel}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                setChannel(next === "SHOPEE" || next === "LAZADA" ? next : "");
              }}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">ให้ระบบเดาจากไฟล์</option>
              <option value="SHOPEE">Shopee (SPMM/XX)</option>
              <option value="LAZADA">Lazada (LZMM/XX)</option>
            </select>
          </label>

          <label
            htmlFor="ecommerce-order-file"
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition",
              isDragging
                ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200"
                : "border-slate-300 bg-slate-50 hover:border-violet-400",
              busy && "pointer-events-none opacity-70",
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
              void handleDrop(event);
            }}
          >
            <input
              ref={inputRef}
              id="ecommerce-order-file"
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                void readFile(event.target.files?.[0]);
              }}
            />
            {isReading ? (
              <Loader2 className="size-5 animate-spin text-violet-700" />
            ) : (
              <ShoppingCart className="size-5 text-violet-700" />
            )}
            <span className="text-sm font-medium text-slate-800">
              ลากไฟล์ .xlsx, .csv, รูป หรือ PDF มาวาง
            </span>
          </label>

          {orders.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">เลือก</th>
                    <th className="px-3 py-2">คำสั่งซื้อ</th>
                    <th className="px-3 py-2">ผู้ซื้อ</th>
                    <th className="px-3 py-2">วันที่</th>
                    <th className="px-3 py-2 text-right">ยอดรายการ</th>
                    <th className="px-3 py-2">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const total = order.items.reduce((sum, line) => sum + line.line_total, 0);
                    return (
                      <tr key={`${order.sales_channel}-${order.ecommerce_order_no}`} className="border-t">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(selected[order.ecommerce_order_no])}
                            onChange={(event) => {
                              setSelected((current) => ({
                                ...current,
                                [order.ecommerce_order_no]: event.target.checked,
                              }));
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium">{order.ecommerce_order_no}</td>
                        <td className="px-3 py-2">{order.ecommerce_buyer_name || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{order.doc_date}</td>
                        <td className="px-3 py-2 text-right">{money(total)}</td>
                        <td className="px-3 py-2">
                          {order.duplicate_doc_no ? (
                            <span className="text-amber-700">ออกแล้ว {order.duplicate_doc_no}</span>
                          ) : (
                            <span className="text-emerald-700">ยังไม่ออกบิล</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy || selectedOrders.length !== 1} onClick={fillSelected}>
            เติมลงฟอร์มเปิดบิล (ABB)
          </Button>
          <Button disabled={busy || selectedOrders.length === 0} onClick={() => void issueSelected()}>
            {isIssuing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            สร้างและออกบิล ABB อัตโนมัติ (รันเลข SPMM/XX หรือ LZMM/XX)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
