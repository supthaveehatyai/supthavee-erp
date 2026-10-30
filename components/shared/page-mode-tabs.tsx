"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { canAccessPath } from "@/lib/auth/module-access";
import { useAccessContext } from "@/components/auth/access-context";

export type PageModeTab = {
  key: string;
  href: string;
  label: string;
};

export function PageModeTabs({
  tabs,
  activeKey,
  ariaLabel,
}: {
  tabs: readonly PageModeTab[];
  activeKey: string;
  ariaLabel: string;
}) {
  const access = useAccessContext();
  const visibleTabs = access
    ? tabs.filter((tab) =>
        canAccessPath(tab.href, access.accessibleModules, access.roleCode),
      )
    : tabs;

  if (visibleTabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex h-10 w-full items-center justify-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 text-slate-600"
    >
      {visibleTabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Link
            key={tab.key}
            role="tab"
            aria-selected={active}
            href={tab.href}
            className={cn(
              "inline-flex h-8 min-w-fit flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition",
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

export const GOODS_RECEIPT_TABS: readonly PageModeTab[] = [
  {
    key: "ocr",
    href: "/dashboard/procurement/goods-receipt",
    label: "สแกนบิลอัจฉริยะ (AI OCR)",
  },
  {
    key: "manual",
    href: "/purchases/manual-receipt",
    label: "บันทึกรับสินค้าเอง (Manual)",
  },
];

export const PAYMENT_TABS: readonly PageModeTab[] = [
  {
    key: "ar",
    href: "/finance/payments",
    label: "รับชำระหนี้ลูกค้า (AR Receipt - REC)",
  },
  {
    key: "ap",
    href: "/finance/ap-payment",
    label: "จ่ายชำระหนี้ซัพพลายเออร์ (AP Payment - PAY)",
  },
];

export const DEPOSIT_MODE_TABS: readonly PageModeTab[] = [
  {
    key: "DEP_IN",
    href: "/finance/deposits?tab=DEP_IN",
    label: "รับเงินมัดจำลูกค้า (DEP_IN)",
  },
  {
    key: "DEP_OUT",
    href: "/finance/deposits?tab=DEP_OUT",
    label: "จ่ายเงินมัดจำซัพพลายเออร์ (DEP_OUT)",
  },
  {
    key: "REFUND",
    href: "/finance/refunds/create",
    label: "คืนเงินมัดจำ (Refund)",
  },
];

export const WRITEOFF_TABS: readonly PageModeTab[] = [
  {
    key: "ar",
    href: "/finance/ar-writeoff/create",
    label: "ตัดหนี้สูญลูกหนี้ (AR Write-off)",
  },
  {
    key: "ap",
    href: "/finance/ap-writeoff",
    label: "ตัดหนี้สูญเจ้าหนี้ (AP Write-off)",
  },
];

export const REPORT_TABS: readonly PageModeTab[] = [
  {
    key: "tax",
    href: "/finance/tax-reports",
    label: "ศูนย์รายงานภาษีและทะเบียนเอกสาร",
  },
  {
    key: "cash-receipt",
    href: "/finance/reports",
    label: "ชุดใบรับเงิน 1.2",
  },
  {
    key: "wht",
    href: "/tax/wht-report",
    label: "รายงานหัก ณ ที่จ่าย (WHT 50 ทวิ)",
  },
  {
    key: "profit",
    href: "/profit-analysis",
    label: "วิเคราะห์กำไร (Profit Analysis)",
  },
];

export const SETTINGS_HUB_TABS: readonly PageModeTab[] = [
  {
    key: "company",
    href: "/settings/company",
    label: "ตั้งค่าข้อมูลบริษัท",
  },
  {
    key: "parameters",
    href: "/settings/parameters",
    label: "ตั้งค่าระบบ",
  },
  {
    key: "master-data",
    href: "/settings/master-data",
    label: "Master Data",
  },
  {
    key: "banks",
    href: "/finance/bank-accounts",
    label: "สมุดบัญชีธนาคาร",
  },
  {
    key: "users",
    href: "/settings/users",
    label: "จัดการผู้ใช้งาน",
  },
];
