"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bindLiffSessionAction } from "@/lib/actions/fnb-identity";
import { FNB_LIFF_SUSPENDED_MESSAGE, type FnbBrandCode } from "@/types/fnb";

export function LiffLogin({ brand, suspended }: { brand: FnbBrandCode; suspended: boolean }) {
  const [lineUserId, setLineUserId] = useState("");
  const [message, setMessage] = useState(suspended ? FNB_LIFF_SUSPENDED_MESSAGE : "");
  const [pending, start] = useTransition();
  const router = useRouter();
  if (suspended) {
    return <main className="min-h-screen bg-red-50 px-4 py-8"><p className="rounded-xl bg-red-700 px-4 py-6 text-center text-white">{FNB_LIFF_SUSPENDED_MESSAGE}</p></main>;
  }
  return (
    <main className="min-h-screen bg-red-50 px-4 py-8">
      <form className="mx-auto max-w-md space-y-3 rounded-xl bg-white p-4" onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const saved = await bindLiffSessionAction(lineUserId, brand);
          if (!saved.ok) {
            toast.error(saved.error || "เข้าสู่ระบบไม่สำเร็จ");
            setMessage(saved.error || "เข้าสู่ระบบไม่สำเร็จ");
            return;
          }
          toast.success(`เข้าสู่ระบบในชื่อ ${saved.name}`);
          router.refresh();
        });
      }}>
        <h1 className="text-xl font-bold">{brand === "LUCKY_CUP" ? "Lucky Cup" : "ชาทรตะโหมด"}</h1>
        <p className="text-sm text-slate-600">ใส่รหัส LINE ที่ผู้จัดการอนุมัติแล้ว ระบบจะใช้ชื่อเล่นในทะเบียน ไม่มีการพิมพ์ชื่อเอง</p>
        {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
        <input className="h-10 w-full rounded-md border px-3 text-sm" value={lineUserId} placeholder="LINE user id" onChange={(event) => setLineUserId(event.target.value)} />
        <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>{pending ? "กำลังตรวจสิทธิ์..." : "เข้าสู่ระบบหน้าร้าน"}</button>
      </form>
    </main>
  );
}
