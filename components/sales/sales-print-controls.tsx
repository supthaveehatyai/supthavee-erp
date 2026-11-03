"use client";

import { useEffect, useState } from "react";
import {
  buildPrintLineRows,
  defaultHideZeroServiceLines,
  defaultPrintNameMode,
  type PrintNameMode,
} from "@/lib/sales/print-line-view";
import type { DocumentDetailItem } from "@/types/document";

type PrintViewDetail = {
  docNo: string;
  nameMode?: PrintNameMode;
  hideZeroServiceLines?: boolean;
};

const PRINT_VIEW_EVENT = "supthavee-sales-print-view";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function SalesPrintOptions({
  docNo,
  docType,
}: {
  docNo: string;
  docType: string;
}) {
  const [nameMode, setNameMode] = useState<PrintNameMode>(() =>
    defaultPrintNameMode(docType),
  );
  const [hideZeroServiceLines, setHideZeroServiceLines] = useState(() =>
    defaultHideZeroServiceLines(docType),
  );

  useEffect(() => {
    setNameMode(defaultPrintNameMode(docType));
    setHideZeroServiceLines(defaultHideZeroServiceLines(docType));
  }, [docNo, docType]);

  function publish(next: PrintViewDetail) {
    window.dispatchEvent(new CustomEvent<PrintViewDetail>(PRINT_VIEW_EVENT, { detail: next }));
  }

  return (
    <fieldset className="flex w-full max-w-xl basis-full flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 print:hidden">
      <legend className="px-1 text-[11px] font-semibold text-slate-500">
        รูปแบบบนกระดาษพิมพ์
      </legend>
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name={`sales-print-name-${docNo}`}
          className="mt-0.5"
          checked={nameMode === "short"}
          onChange={() => {
            setNameMode("short");
            publish({ docNo, nameMode: "short" });
          }}
        />
        <span>ใช้ชื่อย่อสินค้า (short_name) และยุบรวมรายการ</span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name={`sales-print-name-${docNo}`}
          className="mt-0.5"
          checked={nameMode === "sku"}
          onChange={() => {
            setNameMode("sku");
            publish({ docNo, nameMode: "sku" });
          }}
        />
        <span>แสดงรายละเอียดเต็มตาม SKU</span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={hideZeroServiceLines}
          onChange={(event) => {
            const checked = event.target.checked;
            setHideZeroServiceLines(checked);
            publish({ docNo, hideZeroServiceLines: checked });
          }}
        />
        <span>ซ่อนรายการบริการราคา 0 บาท บนใบกำกับภาษี</span>
      </label>
    </fieldset>
  );
}

export function SalesPrintLineTable({
  docNo,
  docType,
  items,
  followDocumentDefaults = false,
}: {
  docNo: string;
  docType: string;
  items: DocumentDetailItem[];
  followDocumentDefaults?: boolean;
}) {
  const [nameMode, setNameMode] = useState<PrintNameMode>(() =>
    followDocumentDefaults ? defaultPrintNameMode(docType) : "sku",
  );
  const [hideZeroServiceLines, setHideZeroServiceLines] = useState(() =>
    followDocumentDefaults ? defaultHideZeroServiceLines(docType) : false,
  );

  useEffect(() => {
    setNameMode(followDocumentDefaults ? defaultPrintNameMode(docType) : "sku");
    setHideZeroServiceLines(
      followDocumentDefaults ? defaultHideZeroServiceLines(docType) : false,
    );
  }, [docNo, docType, followDocumentDefaults]);

  useEffect(() => {
    if (!followDocumentDefaults) return;
    function onView(event: Event) {
      const detail = (event as CustomEvent<PrintViewDetail>).detail;
      if (!detail || detail.docNo !== docNo) return;
      if (detail.nameMode) setNameMode(detail.nameMode);
      if (typeof detail.hideZeroServiceLines === "boolean") {
        setHideZeroServiceLines(detail.hideZeroServiceLines);
      }
    }
    window.addEventListener(PRINT_VIEW_EVENT, onView);
    return () => window.removeEventListener(PRINT_VIEW_EVENT, onView);
  }, [docNo, followDocumentDefaults]);

  const rows = buildPrintLineRows(items, nameMode, hideZeroServiceLines);

  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead>
        <tr className="border-b border-neutral-400">
          <th className="py-1.5 pr-2 font-semibold text-neutral-700">#</th>
          <th className="py-1.5 pr-2 font-semibold text-neutral-700">SKU</th>
          <th className="py-1.5 pr-2 font-semibold text-neutral-700">รายละเอียด</th>
          <th className="py-1.5 pr-2 text-right font-semibold text-neutral-700">จำนวน</th>
          <th className="py-1.5 pr-2 text-center font-semibold text-neutral-700">หน่วย</th>
          <th className="py-1.5 pr-2 text-right font-semibold text-neutral-700">ราคา/หน่วย</th>
          <th className="py-1.5 text-right font-semibold text-neutral-700">รวม</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={7} className="py-6 text-center text-neutral-400">
              ไม่มีรายการสินค้า
            </td>
          </tr>
        ) : (
          rows.map((item, index) => (
            <tr key={item.key} className="border-b border-neutral-200 align-top">
              <td className="py-1.5 pr-2 tabular-nums text-neutral-500">{index + 1}</td>
              <td className="py-1.5 pr-2 font-mono text-[11px] font-medium text-neutral-800">
                {item.sku}
              </td>
              <td className="max-w-[12rem] py-1.5 pr-2 text-neutral-800">{item.description}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-800">{item.qty}</td>
              <td className="py-1.5 pr-2 text-center text-neutral-600">{item.uom_used}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-800">
                {formatMoney(item.unit_price)}
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums text-neutral-900">
                {item.discount_label ? (
                  <div>
                    <div className="text-[10px] text-neutral-400 line-through">
                      {formatMoney(item.gross_amount)}
                    </div>
                    <div>
                      {formatMoney(item.line_total)} ({item.discount_label})
                    </div>
                  </div>
                ) : (
                  formatMoney(item.line_total)
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
