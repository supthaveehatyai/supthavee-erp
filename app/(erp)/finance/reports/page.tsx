import type { Metadata } from "next";
import { CashReceiptCenter } from "@/components/finance/cash-receipt-center";
import { PageModeTabs, REPORT_TABS } from "@/components/shared/page-mode-tabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ชุดใบรับเงิน 1.2 | Cash Receipts",
  description: "รายงานบิลซื้อไม่มี VAT และใบรับเงิน CA สำหรับสำนักงานบัญชี",
};

export default function CashReceiptReportPage() {
  return (
    <div className="space-y-4 p-6 print:p-0">
      <div className="print:hidden">
        <PageModeTabs tabs={REPORT_TABS} activeKey="cash-receipt" ariaLabel="ศูนย์รายงานและภาษี" />
      </div>
      <CashReceiptCenter />
    </div>
  );
}
