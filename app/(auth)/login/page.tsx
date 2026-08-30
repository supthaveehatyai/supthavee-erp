import type { Metadata } from "next";
import { Building2, ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบ",
  description: "Supthavee ERP — Secure Login",
};

/** Public route — Root layout skips session lookup when pathname is /login or /auth. */
export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      {/* Atmosphere — enterprise, not purple AI defaults */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.35),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(15,23,42,0.9),_transparent_50%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/40 ring-1 ring-blue-400/30">
            <Building2 className="size-7 text-white" />
          </div>
          <p className="text-xs font-semibold tracking-[0.2em] text-blue-300 uppercase">
            Supthavee ERP
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
            บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            เข้าสู่ระบบด้วยอีเมลและรหัส PIN 6 หลัก
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl shadow-slate-950/50 sm:p-8">
          <div className="mb-6 flex items-center gap-2 text-slate-600">
            <ShieldCheck className="size-4 text-blue-600" />
            <span className="text-xs font-medium tracking-wide uppercase">
              Secure Staff Login
            </span>
          </div>
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Session ถูกจัดการฝั่ง Server · Zero Client-Side Fetching
        </p>
      </div>
    </div>
  );
}
