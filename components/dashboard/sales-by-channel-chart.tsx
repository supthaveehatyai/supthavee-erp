"use client";

/**
 * Phase 19 — Omnichannel Analytics (Sales by Channel).
 * Client island for Recharts only — data comes from Server Component props.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Store } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatThaiCurrency } from "@/lib/utils/currency";
import type { SalesByChannelDatum } from "@/types/dashboard";

const CHANNEL_COLORS: Record<string, string> = {
  STORE: "#2563eb",
  SHOPEE: "#ea580c",
  LAZADA: "#1d4ed8",
  TIKTOK: "#0f172a",
  DIRECT: "#059669",
};

export type SalesByChannelChartProps = {
  data: SalesByChannelDatum[];
  error?: string | null;
};

export function SalesByChannelChart({
  data,
  error = null,
}: SalesByChannelChartProps) {
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const hasSales = total > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="h-4 w-4 text-blue-600" />
              ยอดขายตามช่องทาง (Omnichannel)
            </CardTitle>
            <CardDescription>
              INV_DO / TAX_INV / CS_TAX / ABB · ISSUED / PAID / COMPLETED ·
              NULL = หน้าร้าน (STORE)
            </CardDescription>
          </div>
          {error ? (
            <Badge variant="amber">Error</Badge>
          ) : (
            <Badge variant="emerald">YTD</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            โหลดยอดขายตามช่องทางไม่สำเร็จ: {error}
          </p>
        ) : null}

        {!error && !hasSales ? (
          <p className="py-10 text-center text-sm text-slate-400">
            ยังไม่มีเอกสารขายที่ยืนยันแล้วในช่วงเวลานี้
          </p>
        ) : null}

        {hasSales ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              รวมทุกช่องทาง{" "}
              <span className="font-semibold tabular-nums text-slate-800">
                {formatThaiCurrency(total)}
              </span>
            </p>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    interval={0}
                    angle={-12}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickFormatter={(value: number) =>
                      new Intl.NumberFormat("th-TH", {
                        notation: "compact",
                        compactDisplay: "short",
                      }).format(value)
                    }
                  />
                  <Tooltip
                    content={(props) => {
                      if (!props.active || !props.payload?.[0]) return null;
                      const entry = props.payload[0];
                      const row = entry.payload as SalesByChannelDatum | undefined;
                      const name = row?.name ?? String(entry.name ?? "");
                      const value = Number(row?.value ?? entry.value ?? 0);
                      if (!name) return null;
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
                          <p className="font-medium text-slate-800">{name}</p>
                          <p className="tabular-nums text-slate-600">
                            {formatThaiCurrency(value)}
                          </p>
                        </div>
                      );
                    }}
                    cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                  />
                  <Bar dataKey="value" name="ยอดขาย" radius={[8, 8, 0, 0]} maxBarSize={56}>
                    {data.map((row) => (
                      <Cell
                        key={row.channel}
                        fill={CHANNEL_COLORS[row.channel] ?? "#64748b"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
