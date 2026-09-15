"use server";

/**
 * Phase 19 — Executive Dashboard: Omnichannel Analytics.
 * Zero Client-Side Fetching — Service Role only.
 *
 * Next.js: a `"use server"` file may ONLY export async functions.
 * Types live in `@/types/dashboard`.
 */

import {
  DEFAULT_SALES_CHANNEL,
  SALES_CHANNEL_LABELS,
  SALES_CHANNELS,
  isSalesChannel,
  type SalesChannelCode,
} from "@/lib/constants/document";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  GetSalesByChannelResult,
  SalesByChannelDatum,
} from "@/types/dashboard";

const CHANNEL_SALES_DOC_TYPES = ["INV_DO", "TAX_INV", "CS_TAX", "ABB"] as const;

/** เอกสารขายที่ยืนยันแล้ว — รวม PAID เพราะบิลเงินสด (ABB/CS_TAX) ขึ้น PAID ได้ */
const CHANNEL_SALES_STATUSES = ["ISSUED", "PAID", "COMPLETED"] as const;

const CHANNEL_REPORT_ORDER: SalesChannelCode[] = [
  "STORE",
  "SHOPEE",
  "LAZADA",
  "TIKTOK",
  "DIRECT",
];

type ChannelSalesRow = {
  sales_channel: string | null;
  grand_total: number | string | null;
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function channelDisplayName(channel: SalesChannelCode): string {
  if (channel === "STORE") return "หน้าร้าน (STORE)";
  if (channel === "DIRECT") return "ขายตรง / B2B (DIRECT)";
  return SALES_CHANNEL_LABELS[channel];
}

function emptyChannelSeries(): SalesByChannelDatum[] {
  return CHANNEL_REPORT_ORDER.map((channel) => ({
    channel,
    name: channelDisplayName(channel),
    value: 0,
  }));
}

function normalizeChannel(
  value: string | null | undefined,
): SalesChannelCode {
  const raw = String(value ?? "").trim();
  if (isSalesChannel(raw)) return raw;
  return DEFAULT_SALES_CHANNEL;
}

/**
 * ยอดขายตามช่องทาง (`documents.sales_channel`) ในช่วงวันที่ที่กำหนด
 * NULL / ค่าว่าง ถือเป็น STORE ตามมาตรฐานเอกสารเก่า
 */
export async function getSalesByChannel(
  startDate: string,
  endDate: string,
): Promise<GetSalesByChannelResult> {
  try {
    const from = String(startDate ?? "").trim();
    const to = String(endDate ?? "").trim();

    if (!isIsoDate(from) || !isIsoDate(to)) {
      return {
        data: emptyChannelSeries(),
        error: "ช่วงวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)",
      };
    }
    if (from > to) {
      return {
        data: emptyChannelSeries(),
        error: "วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด",
      };
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documents")
      .select("sales_channel, grand_total")
      .in("doc_type", [...CHANNEL_SALES_DOC_TYPES])
      .in("status", [...CHANNEL_SALES_STATUSES])
      .not("is_voided", "eq", true)
      .gte("doc_date", from)
      .lte("doc_date", to);

    if (error) {
      console.error("[getSalesByChannel]", error.message);
      return { data: emptyChannelSeries(), error: error.message };
    }

    const totals = new Map<SalesChannelCode, number>(
      SALES_CHANNELS.map((channel) => [channel, 0]),
    );

    for (const row of (data ?? []) as ChannelSalesRow[]) {
      const channel = normalizeChannel(row.sales_channel);
      const next = roundMoney((totals.get(channel) ?? 0) + toMoney(row.grand_total));
      totals.set(channel, next);
    }

    return {
      data: CHANNEL_REPORT_ORDER.map((channel) => ({
        channel,
        name: channelDisplayName(channel),
        value: totals.get(channel) ?? 0,
      })),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดยอดขายตามช่องทางไม่สำเร็จ";
    console.error("[getSalesByChannel]", message);
    return { data: emptyChannelSeries(), error: message };
  }
}
