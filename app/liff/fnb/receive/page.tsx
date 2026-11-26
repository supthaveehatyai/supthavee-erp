import Link from "next/link";

export const dynamic = "force-dynamic";

export default function LiffReceiveRedirectPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-xl font-bold">รับของตามแบรนด์</h1>
      <Link className="rounded-xl bg-red-700 px-4 py-3 text-center text-white" href="/liff/luckycup">Lucky Cup</Link>
      <Link className="rounded-xl bg-red-900 px-4 py-3 text-center text-white" href="/liff/chatorn">ชาทรตะโหมด</Link>
    </main>
  );
}
