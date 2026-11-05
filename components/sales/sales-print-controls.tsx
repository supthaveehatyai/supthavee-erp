"use client";

import { useEffect, useState } from "react";
import {
  buildPrintLineRows,
  defaultHideZeroServiceLines,
  defaultPrintNameMode,
  type PrintNameMode,
} from "@/lib/sales/print-line-view";
import { summarizeGoodsQty } from "@/lib/sales/goods-qty-summary";
import { DocumentPrintFooter } from "@/components/shared/print/DocumentPrintFooter";
import type { DocumentDetailItem } from "@/types/document";

type PrintViewDetail = {
  docNo: string;
  nameMode?: PrintNameMode;
  hideZeroServiceLines?: boolean;
  showSignatures?: boolean;
  showReceiverSignature?: boolean;
};

function isCashReceiptDoc(docType: string): boolean {
  return docType === "CS_TAX" || docType === "REC" || docType === "DEP_IN" || docType === "ABB";
}

function isDeliveryDoc(docType: string): boolean {
  return docType === "TAX_INV" || docType === "INV_DO" || docType === "SO";
}

function defaultShowSignatures(docType: string): boolean {
  return docType !== "ABB";
}

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
  const [showSignatures, setShowSignatures] = useState(() =>
    defaultShowSignatures(docType),
  );
  const [showReceiverSignature, setShowReceiverSignature] = useState(false);
  const lineOptions = docType !== "REC" && docType !== "DEP_IN";

  useEffect(() => {
    setNameMode(defaultPrintNameMode(docType));
    setHideZeroServiceLines(defaultHideZeroServiceLines(docType));
    setShowSignatures(defaultShowSignatures(docType));
    setShowReceiverSignature(false);
  }, [docNo, docType]);

  function publish(next: PrintViewDetail) {
    window.dispatchEvent(new CustomEvent<PrintViewDetail>(PRINT_VIEW_EVENT, { detail: next }));
  }

  return (
    <fieldset className="flex w-full max-w-xl basis-full flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 print:hidden">
      <legend className="px-1 text-[11px] font-semibold text-slate-500">
        รูปแบบบนกระดาษพิมพ์
      </legend>
      {lineOptions ? (
        <>
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
        </>
      ) : null}
      {docType === "ABB" ? (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={showSignatures}
            onChange={(event) => {
              const checked = event.target.checked;
              setShowSignatures(checked);
              publish({ docNo, showSignatures: checked });
            }}
          />
          <span>แสดงช่องลงนามท้ายเอกสาร (ผู้รับเงิน / ผู้มีอำนาจลงนาม)</span>
        </label>
      ) : null}
      {isCashReceiptDoc(docType) && (docType !== "ABB" || showSignatures) ? (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={showReceiverSignature}
            onChange={(event) => {
              const checked = event.target.checked;
              setShowReceiverSignature(checked);
              publish({ docNo, showReceiverSignature: checked });
            }}
          />
          <span>แสดงช่องลงนามผู้รับของเพิ่มเติม</span>
        </label>
      ) : null}
    </fieldset>
  );
}

function PrintSignatureLine({ label }: { label: string }) {
  return (
    <div className="text-center text-[10px] text-neutral-800">
      <div className="mx-auto mb-1 h-6 w-full max-w-[7.5rem] border-b border-neutral-500" />
      <p className="font-semibold">({label})</p>
      <p className="mt-0.5 text-neutral-600">วันที่ ....../....../..........</p>
    </div>
  );
}

function usePrintSignatureChoices(docNo: string, docType: string): {
  showSignatures: boolean;
  showReceiverSignature: boolean;
} {
  const [showSignatures, setShowSignatures] = useState(() =>
    defaultShowSignatures(docType),
  );
  const [showReceiverSignature, setShowReceiverSignature] = useState(false);

  useEffect(() => {
    setShowSignatures(defaultShowSignatures(docType));
    setShowReceiverSignature(false);
  }, [docNo, docType]);

  useEffect(() => {
    function onView(event: Event) {
      const detail = (event as CustomEvent<PrintViewDetail>).detail;
      if (!detail || detail.docNo !== docNo) return;
      if (typeof detail.showSignatures === "boolean") {
        setShowSignatures(detail.showSignatures);
      }
      if (typeof detail.showReceiverSignature === "boolean") {
        setShowReceiverSignature(detail.showReceiverSignature);
      }
    }
    window.addEventListener(PRINT_VIEW_EVENT, onView);
    return () => window.removeEventListener(PRINT_VIEW_EVENT, onView);
  }, [docNo]);

  return { showSignatures, showReceiverSignature };
}

/** ช่องลงนามท้ายกระดาษตามประเภทเอกสาร */
export function SalesPrintSignaturePair({
  docNo,
  docType,
}: {
  docNo: string;
  docType: string;
}) {
  const { showSignatures, showReceiverSignature } = usePrintSignatureChoices(docNo, docType);
  if (isDeliveryDoc(docType)) {
    return (
      <div className="grid grid-cols-2 gap-2 pt-1">
        <PrintSignatureLine label="ผู้รับของ / ผู้รับสินค้า" />
        <PrintSignatureLine label="ผู้ส่งของ / ผู้จัดทำ" />
      </div>
    );
  }
  if (docType === "ABB" && !showSignatures) return null;
  if (!isCashReceiptDoc(docType)) return null;
  return (
    <div className={showReceiverSignature ? "grid grid-cols-2 gap-2 pt-1" : "max-w-[9rem] pt-1"}>
      <PrintSignatureLine label="ผู้รับเงิน / ผู้มีอำนาจลงนาม" />
      {showReceiverSignature ? <PrintSignatureLine label="ผู้รับของ" /> : null}
    </div>
  );
}

/** ช่องเซ็นของเอกสารที่ไม่ได้ใช้ส่วนท้ายแบบแบ่งซ้าย-ขวา */
export function SalesPrintStandardFooter({
  docNo,
  docType,
  receivedLabel = "ผู้รับของ",
}: {
  docNo: string;
  docType: string;
  receivedLabel?: string;
}) {
  const { showSignatures } = usePrintSignatureChoices(docNo, docType);
  if (isCashReceiptDoc(docType) || isDeliveryDoc(docType)) {
    return <SalesPrintSignaturePair docNo={docNo} docType={docType} />;
  }
  if (!showSignatures) return null;
  return (
    <DocumentPrintFooter
      preparedLabel="ผู้จัดทำ"
      receivedLabel={receivedLabel}
      approvedLabel="ผู้อนุมัติ"
      compact
    />
  );
}

export function SalesPrintLineTable({
  docNo,
  docType,
  items,
  followDocumentDefaults = false,
  dense = false,
  hideQtyFoot = false,
}: {
  docNo: string;
  docType: string;
  items: DocumentDetailItem[];
  followDocumentDefaults?: boolean;
  dense?: boolean;
  hideQtyFoot?: boolean;
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
  const goodsQty = summarizeGoodsQty(items);
  const showSku = nameMode !== "short";
  const columnCount = showSku ? 7 : 6;
  const cell = dense ? "py-1 px-1.5 text-[10.5px]" : "py-1.5 pr-2";

  return (
    <table className={dense ? "w-full border-collapse text-left text-[10.5px]" : "w-full border-collapse text-left text-xs"}>
      <thead>
        <tr className="border-b border-neutral-400">
          <th className={`${cell} font-semibold text-neutral-700`}>#</th>
          {showSku ? (
            <th className={`${cell} font-semibold text-neutral-700`}>SKU</th>
          ) : null}
          <th className={`${cell} font-semibold text-neutral-700`}>รายละเอียด</th>
          <th className={`${cell} text-right font-semibold text-neutral-700`}>จำนวน</th>
          <th className={`${cell} text-center font-semibold text-neutral-700`}>หน่วย</th>
          <th className={`${cell} text-right font-semibold text-neutral-700`}>ราคา/หน่วย</th>
          <th className={`${cell} text-right font-semibold text-neutral-700`}>รวม</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columnCount} className="py-6 text-center text-neutral-400">
              ไม่มีรายการสินค้า
            </td>
          </tr>
        ) : (
          rows.map((item, index) => (
            <tr key={item.key} className="border-b border-neutral-200 align-top">
              <td className={`${cell} tabular-nums text-neutral-500`}>{index + 1}</td>
              {showSku ? (
                <td className={`${cell} font-mono font-medium text-neutral-800`}>
                  {item.sku}
                </td>
              ) : null}
              <td className={`${cell} max-w-[12rem] text-neutral-800`}>{item.description}</td>
              <td className={`${cell} text-right tabular-nums text-neutral-800`}>{item.qty}</td>
              <td className={`${cell} text-center text-neutral-600`}>{item.uom_used}</td>
              <td className={`${cell} text-right tabular-nums text-neutral-800`}>
                {formatMoney(item.unit_price)}
              </td>
              <td className={`${cell} text-right font-medium tabular-nums text-neutral-900`}>
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
      {goodsQty.label && !hideQtyFoot ? (
        <tfoot>
          <tr>
            <td colSpan={columnCount} className="pt-2 text-[11px] font-semibold text-neutral-800">
              {goodsQty.label}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
