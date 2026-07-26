import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "แดชบอร์ด",
};

export default function Home() {
  return (
    <div className="mx-auto max-w-[1600px]">
      <div>
        <p className="text-xs font-medium text-blue-600">ภาพรวมระบบ</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          แดชบอร์ด
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          พื้นที่สรุปข้อมูลสำคัญของธุรกิจ
        </p>
      </div>

      <section
        aria-label="พื้นที่แดชบอร์ด"
        className="mt-6 min-h-[calc(100dvh-12rem)] rounded-xl border border-dashed border-slate-300 bg-white/60"
      >
        <div className="grid min-h-[inherit] place-items-center p-8 text-center">
          <div>
            <div className="mx-auto grid size-12 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <svg
                aria-hidden="true"
                className="size-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.75"
              >
                <path
                  d="M4 19V9m5 10V5m5 14v-7m5 7V3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-700">
              พื้นที่แดชบอร์ด
            </p>
            <p className="mt-1 text-xs text-slate-400">
              พร้อมสำหรับเพิ่มข้อมูลสรุปและรายงานในขั้นตอนถัดไป
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
