"use client";

import { Printer } from "lucide-react";

export function ExpensePrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
    >
      <Printer className="h-4 w-4" />
      พิมพ์เอกสาร
    </button>
  );
}
