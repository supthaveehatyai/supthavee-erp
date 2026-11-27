import { redirect } from "next/navigation";
import { ChangePinForm } from "./change-pin-form";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { homeAfterLogin } from "@/lib/holding/access-routes";
import { getUserAccessContext } from "@/lib/holding/workspace-access";

export const dynamic = "force-dynamic";

export default async function ChangePinPage() {
  const current = await getCurrentAuthUser();
  if (!current) redirect("/login?next=/change-pin");
  const ctx = await getUserAccessContext(current.userId);
  if (ctx && !ctx.mustChangePin) redirect(homeAfterLogin(ctx));
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <p className="text-xs font-semibold tracking-wide text-blue-700">เปลี่ยนรหัสครั้งแรก</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">ตั้งรหัส PIN ส่วนตัว</h1>
        <p className="mt-2 text-sm text-slate-500">รหัสเริ่มต้น 555555 ใช้ได้ครั้งเดียว ตั้งรหัส 6 หลักใหม่ก่อนเข้าใช้งาน</p>
        <ChangePinForm />
      </div>
    </div>
  );
}
