import type { Metadata } from "next";
import BankReconcileWorkspace from "@/components/sales/bank-reconcile-workspace";

export const metadata: Metadata = {
  title: "ชนยอด Statement กรุงไทย | Sales",
  description: "นำเข้าไฟล์เดินบัญชีธนาคารกรุงไทยและชนยอดกับบิลขาย",
};

export const maxDuration = 60;

export default function SalesReconcilePage() {
  return <BankReconcileWorkspace />;
}
