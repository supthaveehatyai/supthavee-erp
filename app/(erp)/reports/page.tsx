import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PaymentReceiptRegister } from "@/components/finance/payment-receipt-register";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { canAccessReportCenter } from "@/lib/auth/module-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "สมุดทะเบียนรับ-จ่าย | Report Center",
  description: "ประวัติการรับเงินลูกค้าและการจ่ายคู่ค้า พร้อมส่งออก Excel ให้สำนักงานบัญชี",
};

export default async function PaymentRegisterReportPage() {
  const actor = await getCurrentAuthUser();
  if (!actor) redirect("/login?next=/reports");
  if (!canAccessReportCenter(actor.accessibleModules, actor.roleCode)) {
    redirect("/dashboard?error=unauthorized");
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PaymentReceiptRegister />
    </div>
  );
}
