"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900">โหลดหน้าไม่สำเร็จ</h1>
      <p className="text-sm text-slate-500">
        {error.message?.trim() || "เกิดข้อผิดพลาดระหว่างแสดงผล — หน้านี้ไม่ควรว่าง"}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="inline-flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
      >
        ลองอีกครั้ง
      </button>
    </div>
  );
}
