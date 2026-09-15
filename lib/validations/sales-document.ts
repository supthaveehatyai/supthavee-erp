import { z } from "zod";
import {
  DEFAULT_SALES_CHANNEL,
  SALES_CHANNELS,
  isEcommercePlatformChannel,
  type SalesChannelCode,
} from "@/lib/constants/document";

const optionalBoundedText = (max: number, label: string) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value == null) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    })
    .refine((value) => value == null || value.length <= max, {
      message: `${label}ยาวไม่เกิน ${max} ตัวอักษร`,
    });

/**
 * Phase 19 — One-Time Customer metadata on sales documents.
 * `sales_channel` defaults to STORE. Platform fields are optional and
 * cleared when the channel is STORE / DIRECT.
 */
export const salesDocumentEcommerceSchema = z
  .object({
    sales_channel: z.enum(SALES_CHANNELS).default(DEFAULT_SALES_CHANNEL),
    ecommerce_order_no: optionalBoundedText(100, "เลขที่คำสั่งซื้อ "),
    ecommerce_buyer_name: optionalBoundedText(255, "ชื่อลูกค้าสำหรับออกบิล "),
    tracking_no: optionalBoundedText(100, "เลขพัสดุ "),
  })
  .transform((value) => {
    const isPlatform = isEcommercePlatformChannel(value.sales_channel);
    return {
      sales_channel: value.sales_channel,
      ecommerce_order_no: isPlatform ? value.ecommerce_order_no : null,
      ecommerce_buyer_name: isPlatform ? value.ecommerce_buyer_name : null,
      tracking_no: isPlatform ? value.tracking_no : null,
    };
  });

export type SalesDocumentEcommerceFields = z.output<
  typeof salesDocumentEcommerceSchema
>;

export function parseSalesDocumentEcommerce(
  input: unknown,
):
  | { ok: true; data: SalesDocumentEcommerceFields }
  | { ok: false; error: string } {
  const raw =
    input && typeof input === "object"
      ? {
          ...(input as Record<string, unknown>),
          sales_channel:
            String(
              (input as { sales_channel?: unknown }).sales_channel ?? "",
            ).trim() || DEFAULT_SALES_CHANNEL,
        }
      : { sales_channel: DEFAULT_SALES_CHANNEL };

  const parsed = salesDocumentEcommerceSchema.safeParse(raw);
  if (!parsed.success) {
    const first =
      parsed.error.issues[0]?.message ?? "ข้อมูลช่องทางขายไม่ถูกต้อง";
    return { ok: false, error: first };
  }
  return { ok: true, data: parsed.data };
}

/** ใช้ตอนแปลง / คัดลอกเอกสาร — ถ้า parse ไม่ผ่าน ตกกลับเป็น STORE */
export function ecommerceFieldsFromSource(source: {
  sales_channel?: string | null;
  ecommerce_order_no?: string | null;
  ecommerce_buyer_name?: string | null;
  tracking_no?: string | null;
}): SalesDocumentEcommerceFields {
  const parsed = parseSalesDocumentEcommerce({
    sales_channel: source.sales_channel ?? DEFAULT_SALES_CHANNEL,
    ecommerce_order_no: source.ecommerce_order_no,
    ecommerce_buyer_name: source.ecommerce_buyer_name,
    tracking_no: source.tracking_no,
  });
  if (parsed.ok) return parsed.data;
  return {
    sales_channel: DEFAULT_SALES_CHANNEL,
    ecommerce_order_no: null,
    ecommerce_buyer_name: null,
    tracking_no: null,
  };
}

export function resolveSalesChannel(
  value: string | null | undefined,
): SalesChannelCode {
  const parsed = parseSalesDocumentEcommerce({
    sales_channel: value ?? DEFAULT_SALES_CHANNEL,
  });
  return parsed.ok ? parsed.data.sales_channel : DEFAULT_SALES_CHANNEL;
}
