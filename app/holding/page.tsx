import Link from "next/link";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";

export const dynamic = "force-dynamic";

const CARDS = [
  { href: "/holding/people", title: "บุคลากรและสิทธิ์ทั้งเครือ", detail: "IAM, HR ประจำบริษัท และบัญชีคุณจวง" },
  { href: "/holding/vault", title: "คลังเอกสารบริษัท", detail: "PDF และรูปในถังส่วนตัว พร้อมลิงก์ 1 ชั่วโมง" },
  { href: "/holding/entities", title: "ทะเบียนนิติบุคคล", detail: "ทรัพย์ทวี จัสมิน พลัส ลิ่มวรวิวัฒน์ และครอบครัว" },
  { href: "/holding/bank-accounts", title: "สมุดบัญชีและ QR", detail: "บัญชีรับเงินของทุกธุรกิจ" },
  { href: "/holding/line-access", title: "LINE OA และ LIFF", detail: "คัดลอก Webhook และอนุมัติสิทธิ์" },
];

export default async function HoldingHomePage() {
  await requireSuperAdmin();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold tracking-wide text-slate-500">HD</p>
        <h1 className="text-2xl font-bold text-slate-900">ศูนย์ผู้บริหาร</h1>
        <p className="text-sm text-slate-500">คลังเอกสาร สมุดบัญชี และสิทธิ์ข้ามบริษัท</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {CARDS.map((card) => (
          <Link key={card.href} href={card.href} className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-400">
            <h2 className="font-semibold text-slate-900">{card.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{card.detail}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
