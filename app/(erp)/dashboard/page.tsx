import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { getErpFinancialKpis } from "@/app/actions/dashboard";
import { getSalesByChannel } from "@/lib/actions/dashboard-actions";
import { ManualBackupButton } from "@/components/dashboard/manual-backup-button";
import { getRecentAuditLogs } from "@/lib/actions/audit-actions";
import type { GetRecentAuditLogsResult } from "@/types/audit";
import type {
  ErpFinancialKpis,
  GetSalesByChannelResult,
} from "@/types/dashboard";
import { ExecutiveDashboard } from "./executive-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Executive Dashboard",
};

type DisplayKpi = {
  amount: number;
  formatted: string;
  error: string | null;
  detail?: string | null;
};

function formatThaiBaht(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `฿${formatted}`;
}

function unwrapFinancial(
  settled: PromiseSettledResult<ErpFinancialKpis>,
): ErpFinancialKpis {
  if (settled.status === "fulfilled") return settled.value;
  const reason = settled.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "โหลดตัวชี้วัดการเงินไม่สำเร็จ";
  return {
    grossSalesIncVat: 0,
    netRevenueExVat: 0,
    platformFees: 0,
    garmentCogsExVat: 0,
    serviceLaborCost: 0,
    bomMaterialCogs: 0,
    directConsumablesCogs: 0,
    opexExpenses: 0,
    trueNetProfit: 0,
    pendingAr: 0,
    pendingAp: 0,
    error: message,
  };
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

function unwrapSalesByChannel(
  settled: PromiseSettledResult<GetSalesByChannelResult>,
): GetSalesByChannelResult {
  if (settled.status === "fulfilled") {
    return settled.value;
  }

  const reason = settled.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Failed to load sales by channel";

  return { data: [], error: message };
}

function currentYearBounds(): { from: string; to: string } {
  const year = new Date().getFullYear();
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };
}

/**
 * Convert Server Action KPI result → display props.
 * - success (incl. zero): Thai Baht string
 * - failure: em dash + error message for the UI banner
 */
function toDisplayKpi(
  amount: number,
  error: string | null,
  detail?: string | null,
): DisplayKpi {
  if (error) return { amount: 0, formatted: "—", error, detail: null };
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    formatted: formatThaiBaht(amount),
    error: null,
    detail: detail ?? null,
  };
}

export default async function ExecutiveDashboardPage() {
  const { from, to } = currentYearBounds();
  // allSettled — no unhandled rejections even if a Server Action throws
  const [financialSettled, auditSettled, channelSettled] = await Promise.allSettled([
    getErpFinancialKpis(from, to),
    getRecentAuditLogs(),
    getSalesByChannel(from, to),
  ]);

  const financial = unwrapFinancial(financialSettled);
  const ytdSales = toDisplayKpi(
    financial.grossSalesIncVat,
    financial.error,
    financial.error ? null : `Net Revenue (ก่อน VAT) ${formatThaiBaht(financial.netRevenueExVat)}`,
  );
  const pendingAr = toDisplayKpi(financial.pendingAr, financial.error);
  const pendingAp = toDisplayKpi(financial.pendingAp, financial.error);
  const totalExpenses = toDisplayKpi(financial.opexExpenses, financial.error);
  const auditResult = unwrapAudit(auditSettled);
  const channelResult = unwrapSalesByChannel(channelSettled);
  const netProfit = toDisplayKpi(financial.trueNetProfit, financial.error);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <LayoutDashboard className="h-8 w-8 text-blue-600" />
            Executive Dashboard
          </h1>
          <p className="text-slate-500">
            ภาพรวมธุรกิจ · True Net Profit = Net Revenue - ต้นทุนเสื้อ/วัตถุดิบผลิต - ค่าแรงบริการ - OPEX
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
        salesByChannel={channelResult.data}
        salesByChannelError={channelResult.error}
        auditLogs={auditResult.data}
        auditError={auditResult.error}
      />
    </div>
  );
}
