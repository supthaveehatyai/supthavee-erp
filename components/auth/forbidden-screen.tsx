import Link from "next/link";
import { ShieldOff } from "lucide-react";

export type ForbiddenScreenProps = {
  pathname?: string;
  moduleLabel?: string | null;
};

export function ForbiddenScreen({
  pathname,
  moduleLabel,
}: ForbiddenScreenProps) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <div className="grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600">
        <ShieldOff className="size-7" />
      </div>
      <p className="text-sm font-semibold tracking-wide text-red-600">
        403 Forbidden
      </p>
      <h1 className="text-2xl font-bold text-slate-900">ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
      <p className="text-sm text-slate-500">
        บทบาทของคุณไม่มีสิทธิ์โมดูล
        {moduleLabel ? (
          <>
            {" "}
            <span className="font-semibold text-slate-700">{moduleLabel}</span>
          </>
        ) : (
          " ที่ต้องการ"
        )}
        {pathname ? (
          <>
            {" "}
            สำหรับเส้นทาง{" "}
            <span className="font-mono text-xs text-slate-600">{pathname}</span>
          </>
        ) : null}
      </p>
      <Link
        href="/dashboard"
        className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        กลับแดชบอร์ด
      </Link>
    </div>
  );
}
