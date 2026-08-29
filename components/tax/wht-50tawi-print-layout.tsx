"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import {
  WHT_50_TAWI_COPY_TITLES,
  buildWht50TawiCertificateBody,
} from "@/lib/tax/wht-50tawi-format";
import type { Wht50TawiPayer, Wht50TawiPrintPayload } from "@/types/tax-wht-print";
import { Wht50TawiAutoPrint } from "@/components/tax/wht-50tawi-auto-print";
import { Wht50TawiCertificate } from "@/components/tax/wht-50tawi-certificate";

export type Wht50TawiPrintLayoutProps = {
  payload: Wht50TawiPrintPayload;
  payer: Wht50TawiPayer;
  closeHref: string;
  autoPrint?: boolean;
};

export function Wht50TawiPrintLayout({
  payload,
  payer,
  closeHref,
  autoPrint = true,
}: Wht50TawiPrintLayoutProps) {
  const certificateBody = buildWht50TawiCertificateBody(payload, payer);
  const sourceLabel = payload.source === "TB" ? "TB" : "EXP";

  return (
    <div className="font-sarabun">
      {autoPrint ? <Wht50TawiAutoPrint /> : null}

      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) — 4 ฉบับ
          </p>
          <p className="text-xs text-slate-500">
            {sourceLabel} · {payload.documentNo} · {certificateBody.payDateShort}
            {payload.whtType ? ` · ${payload.whtType}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white"
          >
            <Printer className="h-3.5 w-3.5" />
            พิมพ์อีกครั้ง
          </button>
          <Link
            href={closeHref}
            className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
          >
            ปิด
          </Link>
        </div>
      </div>

      <div className="bg-slate-200 py-4 print:bg-white print:py-0">
        {WHT_50_TAWI_COPY_TITLES.map((copyTitle, index) => (
          <div
            key={copyTitle}
            className={
              index < WHT_50_TAWI_COPY_TITLES.length - 1
                ? "mb-4 print:mb-0 print:break-after-page page-break-after-always"
                : ""
            }
          >
            <Wht50TawiCertificate copyTitle={copyTitle} {...certificateBody} />
          </div>
        ))}
      </div>
    </div>
  );
}
