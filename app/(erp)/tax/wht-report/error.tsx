"use client";

/**
 * WHT Report — Client Error Boundary
 * Catches render/runtime errors in this route segment.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

type WhtReportErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const isDev = process.env.NODE_ENV === "development";

export default function WhtReportError({ error, reset }: WhtReportErrorProps) {
  useEffect(() => {
    console.error("[tax/wht-report/error]", error);
  }, [error]);

  const message = error.message?.trim() || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-red-200 bg-red-50/60 px-6 py-10 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-red-100 text-red-600">
          <AlertTriangle className="size-7" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">
            โหลดรายงานหัก ณ ที่จ่ายไม่สำเร็จ
          </h1>
          <p className="text-sm text-slate-600">
            ระบบไม่สามารถแสดงหน้ารายงาน WHT ได้ชั่วคราว กรุณาลองโหลดใหม่อีกครั้ง
          </p>
        </div>

        {isDev ? (
          <div className="w-full rounded-xl border border-red-200 bg-white px-4 py-3 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
              Dev — Error Message
            </p>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-red-800">
              {message}
            </pre>
            {error.digest ? (
              <p className="mt-2 font-mono text-[10px] text-slate-500">
                digest: {error.digest}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            <RotateCcw className="size-4" />
            ลองโหลดใหม่ (Try Again)
          </button>
          <Link
            href="/tax/wht-report"
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            กลับหน้ารายงาน
          </Link>
        </div>
      </div>
    </div>
  );
}
