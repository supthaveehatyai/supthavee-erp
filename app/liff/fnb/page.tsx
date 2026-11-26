import Link from "next/link";

export const dynamic = "force-dynamic";

export default function LiffBrandPickerPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 bg-slate-50 px-4">
      <h1 className="text-2xl font-bold text-slate-900">เลือกแบรนด์ประจำร้าน</h1>
      <Link href="/liff/luckycup" className="rounded-xl bg-red-700 px-4 py-4 text-center font-semibold text-white">เข้า Lucky Cup</Link>
      <Link href="/liff/chatorn" className="rounded-xl bg-red-900 px-4 py-4 text-center font-semibold text-white">เข้าชาทรตะโหมด</Link>
    </main>
  );
}
