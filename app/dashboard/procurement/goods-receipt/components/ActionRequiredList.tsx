"use client";

import { AlertTriangle } from "lucide-react";
import { InternalProductCombobox } from "./InternalProductCombobox";
import type { ProductSummary, UnmatchedOcrLine } from "../types";

type ActionRequiredListProps = {
  rows: UnmatchedOcrLine[];
  products: ProductSummary[];
  mappingLineKey: string | null;
  onMapProduct: (line: UnmatchedOcrLine, productId: string) => void;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ActionRequiredList({
  rows,
  products,
  mappingLineKey,
  onMapProduct,
}: ActionRequiredListProps) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-slate-400">
        ไม่มีรายการค้างจับคู่ — พร้อมรับของทั้งหมด
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const isBusy = mappingLineKey === row.lineKey;
        return (
          <li
            key={row.lineKey}
            className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-xs font-bold text-slate-900">
                    {row.normalizedSku || "(ว่าง)"}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    qty {row.ocr.qty.toLocaleString("th-TH")} ·{" "}
                    {formatMoney(row.ocr.unit_price)} บาท
                  </p>
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  {row.ocr.raw_description || "ไม่มีคำอธิบายจาก OCR"}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  raw_code:{" "}
                  <span className="font-mono">{row.ocr.raw_code || "—"}</span>
                </p>

                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
                    เลือกสินค้าภายในเพื่อจับคู่ทันที
                  </p>
                  <InternalProductCombobox
                    products={products}
                    value=""
                    disabled={isBusy || !row.normalizedSku}
                    onChange={(productId) => onMapProduct(row, productId)}
                    placeholder={
                      isBusy
                        ? "กำลังบันทึกการจับคู่..."
                        : "ค้นหาและเลือก SKU ภายใน..."
                    }
                  />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
