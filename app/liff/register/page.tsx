import { LiffRegisterForm } from "@/app/liff/register/liff-register-form";

export const dynamic = "force-dynamic";

export default function LiffRegisterPage() {
  return (
    <main className="min-h-dvh bg-slate-100 px-4 py-10">
      <LiffRegisterForm />
    </main>
  );
}
