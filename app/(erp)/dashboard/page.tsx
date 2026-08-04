import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import {
  getPendingAP,
  getPendingAR,
  getYTDExpenses,
  getYTDSales,
} from "@/app/actions/dashboard";
import { ManualBackupButton } from "@/components/dashboard/manual-backup-button";
import { getRecentAuditLogs } from "@/lib/actions/audit-actions";
import type { GetRecentAuditLogsResult } from "@/types/audit";
import type { KpiMoneyResult } from "@/types/dashboard";
import { ExecutiveDashboard } from "./executive-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Executive Dashboard",
};

type DisplayKpi = {
  amount: number;
  formatted: string;
  error: string | null;
};

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function unwrapKpi(
  settled: PromiseSettledResult<KpiMoneyResult>,
  fallbackError: string,
): KpiMoneyResult {
  if (settled.status === "fulfilled") {
    return settled.value;
  }

  const reason = settled.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : fallbackError;

  return { amount: 0, error: message };
}

function unwrapAudit(
  settled: PromiseSettledResult<GetRecentAuditLogsResult>,
): GetRecentAuditLogsResult {
  if (settled.status === "fulfilled") {
    return settled.value;
  }

  const reason = settled.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Failed to load audit logs";

  return { data: [], error: message };
}

/**
 * Convert Server Action KPI result → display props.
 * - success (incl. zero): Thai Baht string
 * - failure: em dash + error message for the UI banner
 */
function toDisplayKpi(result: KpiMoneyResult): DisplayKpi {
  if (result.error) {
    return {
      amount: 0,
      formatted: "—",
      error: result.error,
    };
  }

  const amount = Number.isFinite(result.amount) ? result.amount : 0;

  return {
    amount,
    formatted: formatThaiBaht(amount),
    error: null,
  };
}

export default async function ExecutiveDashboardPage() {
  // allSettled — no unhandled rejections even if a Server Action throws
  const [ytdSettled, arSettled, apSettled, opexSettled, auditSettled] =
    await Promise.allSettled([
      getYTDSales(),
      getPendingAR(),
      getPendingAP(),
      getYTDExpenses(),
      getRecentAuditLogs(),
    ]);

  const ytdSales = toDisplayKpi(
    unwrapKpi(ytdSettled, "Failed to load YTD sales"),
  );
  const pendingAr = toDisplayKpi(
    unwrapKpi(arSettled, "Failed to load pending AR"),
  );
  const pendingAp = toDisplayKpi(
    unwrapKpi(apSettled, "Failed to load pending AP"),
  );
  const totalExpenses = toDisplayKpi(
    unwrapKpi(opexSettled, "Failed to load YTD expenses"),
  );
  const auditResult = unwrapAudit(auditSettled);

  // True Net Profit = Gross (YTD Sales, pre-COGS) − OPEX
  const netProfitAmount = roundMoney(ytdSales.amount - totalExpenses.amount);
  const netProfitError =
    ytdSales.error || totalExpenses.error
      ? [ytdSales.error, totalExpenses.error]
          .filter((msg): msg is string => Boolean(msg))
          .join(" · ")
      : null;
  const netProfit: DisplayKpi = netProfitError
    ? { amount: 0, formatted: "—", error: netProfitError }
    : {
        amount: netProfitAmount,
        formatted: formatThaiBaht(netProfitAmount),
        error: null,
      };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <LayoutDashboard className="h-8 w-8 text-blue-600" />
            Executive Dashboard
          </h1>
          <p className="text-slate-500">
            ภาพรวมธุรกิจ · True Net Profit (Sales − OPEX) · Audit Trail · Manual
            Backup — Phase 9 (Zero Client-Side Fetching)
          </p>
        </div>
        <ManualBackupButton />
      </div>

      <ExecutiveDashboard
        kpis={{
          ytdSales,
          pendingAr,
          pendingAp,
          totalExpenses,
          netProfit,
        }}
        auditLogs={auditResult.data}
        auditError={auditResult.error}
      />
    </div>
  );
}
