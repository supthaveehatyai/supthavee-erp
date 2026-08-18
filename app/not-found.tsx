import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
        <FileQuestion className="size-7" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900">ไม่พบหน้าที่ต้องการ</h1>
      <p className="text-sm text-slate-500">
        เอกสารหรือใบสั่งผลิตนี้อาจถูกลบ ยกเลิก หรือเลขที่ในลิงก์ไม่ถูกต้อง
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/sales"
          className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          เอกสารขาย
        </Link>
        <Link
          href="/purchases"
          className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          เอกสารซื้อ
        </Link>
        <Link
          href="/production/kanban"
          className="inline-flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Production Kanban
        </Link>
      </div>
    </div>
  );
}
