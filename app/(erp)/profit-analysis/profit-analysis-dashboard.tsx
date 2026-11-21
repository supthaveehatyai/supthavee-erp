"use client";

/**
 * Phase 12 — Profit Analysis presentation island.
 * All numbers come from the Server Component parent (Zero Client-Side Fetching).
 */

import type { ReactNode } from "react";
import Link from "next/link";
import {
  CircleDollarSign,
  Package,
  Percent,
  Receipt,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ProfitMonthKpi, SalesProfitRow } from "@/types/profit-analysis";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type ProfitAnalysisDashboardProps = {
  monthLabel: string;
  kpi: ProfitMonthKpi;
  rows: SalesProfitRow[];
  formatted: {
    revenue: string;
    cogs: string;
    grossProfit: string;
    opex: string;
    netProfit: string;
  };
};

type KpiCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  accent: string;
  valueClassName?: string;
};

function moneyToneClass(amount: number): string {
  if (amount > 0) return "text-green-600";
  if (amount < 0) return "text-red-600";
  return "text-slate-800";
}

function formatDocDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatMargin(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function buildKpiCards(
  kpi: ProfitMonthKpi,
  formatted: ProfitAnalysisDashboardProps["formatted"],
): KpiCard[] {
  return [
    {
      key: "revenue",
      label: "Revenue",
      value: formatted.revenue,
      hint: "รายได้สุทธิก่อน VAT · รวมมัดจำที่รับรู้ · หัก CN และค่าธรรมเนียมแพลตฟอร์ม",
      icon: <CircleDollarSign className="h-5 w-5" />,
      accent: "bg-blue-50 text-blue-700 border-blue-100",
    },
    {
      key: "cogs",
      label: "Actual COGS",
      value: formatted.cogs,
      hint: `เสื้อ ${formatThaiBaht(kpi.garmentCogs)} · วัตถุดิบ ${formatThaiBaht(kpi.bomMaterialCogs)} · สิ้นเปลือง ${formatThaiBaht(kpi.consumablesCogs)} · ค่าแรง ${formatThaiBaht(kpi.serviceLaborCost)}`,
      icon: <Package className="h-5 w-5" />,
      accent: "bg-amber-50 text-amber-800 border-amber-100",
    },
    {
      key: "gross",
      label: "Gross Profit",
      value: formatted.grossProfit,
      hint: "กำไรขั้นต้น = Revenue − Actual COGS",
      icon: <TrendingUp className="h-5 w-5" />,
      accent: "bg-emerald-50 text-emerald-700 border-emerald-100",
      valueClassName: moneyToneClass(kpi.grossProfit),
    },
    {
      key: "opex",
      label: "OPEX",
      value: formatted.opex,
      hint: "ค่าใช้จ่ายดำเนินงาน · expenses.net_payable · ISSUED",
      icon: <Receipt className="h-5 w-5 text-red-600" />,
      accent: "bg-red-50 text-red-700 border-red-100",
      valueClassName: "text-red-600",
    },
    {
      key: "net",
      label: "Net Profit",
      value: formatted.netProfit,
      hint: "True Net Profit = Net Revenue - ต้นทุนเสื้อ/วัตถุดิบผลิต - ค่าแรงบริการ - OPEX",
      icon: <TrendingDown className="h-5 w-5" />,
      accent: "bg-slate-50 text-slate-700 border-slate-200",
      valueClassName: moneyToneClass(kpi.netProfit),
    },
  ];
}

export function ProfitAnalysisDashboard({
  monthLabel,
  kpi,
  rows,
  formatted,
}: ProfitAnalysisDashboardProps) {
  const cards = buildKpiCards(kpi, formatted);

  const statement: Array<{ label: string; amount: number; emphasize?: boolean }> = [
    {
      label: "รายได้จากการขายสุทธิก่อน VAT (รวมรับรู้เงินมัดจำ หักใบลดหนี้ CN และค่าธรรมเนียมแพลตฟอร์ม)",
      amount: kpi.revenue,
    },
    {
      label: "หัก ต้นทุนเสื้อสำเร็จรูปซื้อมาขายไป (TAS 2 ก่อน VAT)",
      amount: kpi.garmentCogs,
    },
    {
      label: "หัก ต้นทุนวัตถุดิบการผลิต (ตัดตามสูตร BOM & เบิกหน้างาน)",
      amount: kpi.bomMaterialCogs,
    },
    {
      label: "หัก ต้นทุนวัสดุสิ้นเปลืองโรงงาน (สียางสกรีน / เคมีบล็อก / วัสดุไม่ผูก SKU สุทธิหลังหัก AP_CN)",
      amount: kpi.consumablesCogs,
    },
    {
      label: "หัก ต้นทุนค่าแรงงานบริการ (สกรีน / ปัก / บล็อก)",
      amount: kpi.serviceLaborCost,
    },
    {
      label: "หัก ค่าใช้จ่ายดำเนินงาน (OPEX)",
      amount: kpi.opex,
    },
    {
      label: "กำไรสุทธิที่แท้จริง (True Net Profit)",
      amount: kpi.netProfit,
      emphasize: true,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">สมการเดียวกับ Executive Dashboard</CardTitle>
          <CardDescription>
            ช่วง {monthLabel} · ตัวเลขจาก get_erp_financial_kpis_and_profit ชุดเดียวกับการ์ดกำไรสุทธิ
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {statement.map((line) => (
            <div
              key={line.label}
              className={cn(
                "flex items-start justify-between gap-4 rounded-lg px-3 py-2",
                line.emphasize ? "bg-slate-900 text-white" : "bg-slate-50",
              )}
            >
              <p className={cn("text-sm", line.emphasize ? "font-semibold" : "text-slate-700")}>
                {line.label}
              </p>
              <p className={cn("shrink-0 text-sm font-semibold tabular-nums", line.emphasize ? moneyToneClass(line.amount) : "text-slate-900", line.emphasize && line.amount > 0 && "text-emerald-300", line.emphasize && line.amount < 0 && "text-red-300")}>
                {formatThaiBaht(line.amount)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.key} className={`border ${card.accent}`}>
            <CardHeader className="border-b-0 pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardDescription className="text-[11px] font-semibold uppercase tracking-wide text-inherit/80">
                    {card.label}
                  </CardDescription>
                  <CardTitle
                    className={cn(
                      "mt-2 truncate text-2xl font-bold tracking-tight sm:text-3xl",
                      card.valueClassName,
                    )}
                  >
                    {card.value}
                  </CardTitle>
                </div>
                <div className="shrink-0 rounded-xl bg-white/70 p-2.5 shadow-sm">
                  {card.icon}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              <p className="text-xs text-slate-500">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Percent className="h-4 w-4 text-blue-600" />
                กำไรแยกตามบิลขาย
              </CardTitle>
              <CardDescription className="mt-1">
                เดือน {monthLabel} · ISSUED · INV_DO / TAX_INV / ABB / CS_TAX ·
                Actual COGS = ต้นทุนเสื้อเปล่า + ค่าแรงจาก production_jobs
              </CardDescription>
            </div>
            <Badge variant="slate">{rows.length} รายการ</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">
              ไม่พบเอกสารขายที่ออกแล้วในเดือนนี้
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Document No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden md:table-cell">ลูกค้า</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">
                      ต้นทุนสินค้า
                    </TableHead>
                    <TableHead className="hidden text-right lg:table-cell">
                      ค่าแรง
                    </TableHead>
                    <TableHead className="text-right">Actual COGS</TableHead>
                    <TableHead className="text-right">Gross Profit</TableHead>
                    <TableHead className="text-right">GP Margin %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.documentId || row.documentNumber}>
                      <TableCell className="font-medium text-slate-800">
                        {row.documentNumber ? (
                          <Link
                            href={`/sales/${encodeURIComponent(row.documentNumber)}`}
                            className="text-blue-700 hover:underline"
                          >
                            {row.documentNumber}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {row.docType ? (
                          <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                            {row.docType}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-600">
                        {formatDocDate(row.documentDate)}
                      </TableCell>
                      <TableCell className="hidden max-w-[14rem] truncate text-slate-600 md:table-cell">
                        {row.contactName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {formatThaiBaht(row.revenue)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums text-slate-600 lg:table-cell">
                        {formatThaiBaht(row.productCogs)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums text-slate-600 lg:table-cell">
                        {formatThaiBaht(row.wageCogs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {formatThaiBaht(row.cogs)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums font-medium",
                          moneyToneClass(row.grossProfit),
                        )}
                      >
                        {formatThaiBaht(row.grossProfit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {formatMargin(row.gpMarginPercent)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatThaiBaht(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return `฿${new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}
