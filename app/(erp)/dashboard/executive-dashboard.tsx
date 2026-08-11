"use client";

/**
 * Phase 8 — Executive Dashboard tabs (Client island for Tabs state only).
 * All data is loaded by the Server Component parent — Zero Client-Side Fetching.
 */

import type { ReactNode } from "react";
import {
  Activity,
  CircleDollarSign,
  HandCoins,
  Landmark,
  Receipt,
  ScrollText,
  TrendingUp,
} from "lucide-react";
import type { RecentAuditLog } from "@/types/audit";
import { AuditTrailTable } from "@/components/dashboard/audit-trail-table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type DisplayKpi = {
  amount: number;
  /** Pre-formatted Thai Baht from the Server Component */
  formatted: string;
  error: string | null;
};

export type ExecutiveKpis = {
  ytdSales: DisplayKpi;
  pendingAr: DisplayKpi;
  pendingAp: DisplayKpi;
  totalExpenses: DisplayKpi;
  netProfit: DisplayKpi;
};

export type ExecutiveDashboardProps = {
  kpis: ExecutiveKpis;
  auditLogs: RecentAuditLog[];
  auditError?: string | null;
};

type KpiCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  accent: string;
  valueClassName?: string;
  error?: string | null;
};

function netProfitValueClass(amount: number, hasError: boolean): string {
  if (hasError) return "text-slate-700";
  if (amount > 0) return "text-green-600";
  if (amount < 0) return "text-red-600";
  return "text-slate-800";
}

function buildKpiCards(kpis: ExecutiveKpis): KpiCard[] {
  return [
    {
      key: "sales-ytd",
      label: "Total Sales (YTD)",
      value: kpis.ytdSales.formatted,
      hint: kpis.ytdSales.error
        ? "โหลดยอดขายไม่สำเร็จ"
        : "Σ grand_total · INV_DO / TAX_INV / ABB · ปีปัจจุบัน (ไม่รวม DRAFT/VOID)",
      icon: <CircleDollarSign className="h-5 w-5" />,
      accent: "bg-blue-50 text-blue-700 border-blue-100",
      error: kpis.ytdSales.error,
    },
    {
      key: "ar",
      label: "Pending Receivables (AR)",
      value: kpis.pendingAr.formatted,
      hint: kpis.pendingAr.error
        ? "โหลดลูกหนี้ไม่สำเร็จ"
        : "Σ (grand_total − paid) · INV_DO / TAX_INV · ISSUED / PARTIAL",
      icon: <HandCoins className="h-5 w-5" />,
      accent: "bg-emerald-50 text-emerald-700 border-emerald-100",
      error: kpis.pendingAr.error,
    },
    {
      key: "ap",
      label: "Pending Payables (AP)",
      value: kpis.pendingAp.formatted,
      hint: kpis.pendingAp.error
        ? "โหลดเจ้าหนี้ไม่สำเร็จ"
        : "Σ (grand_total − paid) · AP_INV / AP_TAX · ISSUED / PARTIAL",
      icon: <Landmark className="h-5 w-5" />,
      accent: "bg-amber-50 text-amber-800 border-amber-100",
      error: kpis.pendingAp.error,
    },
    {
      key: "opex",
      label: "Total Expenses (OPEX)",
      value: kpis.totalExpenses.formatted,
      hint: kpis.totalExpenses.error
        ? "โหลดค่าใช้จ่ายไม่สำเร็จ"
        : "Σ net_amount · expenses · ISSUED · YTD (expense_date)",
      icon: <Receipt className="h-5 w-5 text-red-600" />,
      accent: "bg-red-50 text-red-700 border-red-100",
      valueClassName: kpis.totalExpenses.error
        ? undefined
        : "text-red-600",
      error: kpis.totalExpenses.error,
    },
    {
      key: "net-profit",
      label: "Net Profit (กำไรสุทธิ)",
      value: kpis.netProfit.formatted,
      hint: kpis.netProfit.error
        ? "คำนวณกำไรสุทธิไม่สำเร็จ"
        : "True Net Profit = YTD Sales − Wage Cost (COGS) − OPEX",
      icon: <TrendingUp className="h-5 w-5" />,
      accent: "bg-slate-50 text-slate-700 border-slate-200",
      valueClassName: netProfitValueClass(
        kpis.netProfit.amount,
        Boolean(kpis.netProfit.error),
      ),
      error: kpis.netProfit.error,
    },
  ];
}

function BusinessOverviewTab({ kpis }: { kpis: ExecutiveKpis }) {
  const cards = buildKpiCards(kpis);
  const kpiErrors = [
    kpis.ytdSales.error,
    kpis.pendingAr.error,
    kpis.pendingAp.error,
    kpis.totalExpenses.error,
    kpis.netProfit.error,
  ].filter((msg): msg is string => Boolean(msg));

  return (
    <div className="space-y-4">
      {kpiErrors.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          บาง KPI โหลดไม่สำเร็จ — แสดงเป็น &quot;—&quot; ชั่วคราว
          <ul className="mt-1 list-disc pl-5 text-xs">
            {kpiErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {cards.map((kpi) => (
          <Card key={kpi.key} className={`border ${kpi.accent}`}>
            <CardHeader className="border-b-0 pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardDescription className="text-[11px] font-semibold uppercase tracking-wide text-inherit/80">
                    {kpi.label}
                  </CardDescription>
                  <CardTitle
                    className={cn(
                      "mt-2 truncate text-2xl font-bold tracking-tight sm:text-3xl",
                      kpi.valueClassName,
                    )}
                  >
                    {kpi.value}
                  </CardTitle>
                </div>
                <div className="shrink-0 rounded-xl bg-white/70 p-2.5 shadow-sm">
                  {kpi.icon}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">{kpi.hint}</p>
                {kpi.error ? (
                  <Badge variant="amber">Error</Badge>
                ) : (
                  <Badge variant="emerald">Live</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-blue-600" />
            Business Overview
          </CardTitle>
          <CardDescription>
            YTD Sales / AR / AP / OPEX ดึงจาก Server Actions แบบ Real-time — ค่า{" "}
            <span className="font-medium text-slate-600">฿0.00</span>{" "}
            หมายถึงยังไม่มีเอกสารตรงเงื่อนไข · Net Profit = Sales − OPEX
            (ก่อนหัก COGS จาก Cost Snapshot)
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function AuditTrailTab({
  logs,
  error,
}: {
  logs: RecentAuditLog[];
  error?: string | null;
}) {
  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ไม่สามารถโหลด Audit Trail ได้: {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4 text-blue-600" />
            System Audit Trail
          </CardTitle>
          <CardDescription>
            50 รายการล่าสุด · สรุปการเปลี่ยนแปลงจาก JSONB อัตโนมัติ · Zero
            Client-Side Fetching
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTrailTable logs={logs} />
        </CardContent>
      </Card>
    </div>
  );
}

export function ExecutiveDashboard({
  kpis,
  auditLogs,
  auditError,
}: ExecutiveDashboardProps) {
  return (
    <Tabs defaultValue="overview" className="space-y-5">
      <TabsList>
        <TabsTrigger value="overview">Business Overview</TabsTrigger>
        <TabsTrigger value="audit">System Audit Trail</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <BusinessOverviewTab kpis={kpis} />
      </TabsContent>

      <TabsContent value="audit">
        <AuditTrailTab logs={auditLogs} error={auditError} />
      </TabsContent>
    </Tabs>
  );
}
