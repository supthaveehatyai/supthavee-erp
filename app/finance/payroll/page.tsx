import type { Metadata } from "next";
import { PayrollCenter } from "@/app/finance/payroll/payroll-center";

export const metadata: Metadata = {
  title: "เงินเดือน / ประกันสังคม",
  description: "ระบบพนักงาน เงินเดือน และประกันสังคม",
};

export const dynamic = "force-dynamic";

export default function PayrollPage() {
  return <PayrollCenter />;
}
