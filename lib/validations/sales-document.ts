import { z } from "zod";
import {
  DEFAULT_SALES_CHANNEL,
  SALES_CHANNELS,
  isEcommercePlatformChannel,
  isWalkInCashDocType,
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
 * `sales_channel` defaults to STORE. Platform-only fields (order no / tracking)
 * are cleared when the channel is STORE / DIRECT. Buyer name + address
 * remain so walk-in cash docs can snapshot them.
 */
export const salesDocumentEcommerceSchema = z
  .object({
    sales_channel: z.enum(SALES_CHANNELS).default(DEFAULT_SALES_CHANNEL),
    ecommerce_order_no: optionalBoundedText(100, "เลขที่คำสั่งซื้อ "),
    ecommerce_buyer_name: optionalBoundedText(255, "ชื่อลูกค้าสำหรับออกบิล "),
    tracking_no: optionalBoundedText(100, "เลขพัสดุ "),
    one_time_address: optionalBoundedText(2000, "ที่อยู่ One-Time "),
  })
  .transform((value) => {
    const isPlatform = isEcommercePlatformChannel(value.sales_channel);
    return {
      sales_channel: value.sales_channel,
      ecommerce_order_no: isPlatform ? value.ecommerce_order_no : null,
      ecommerce_buyer_name: value.ecommerce_buyer_name,
      tracking_no: isPlatform ? value.tracking_no : null,
      one_time_address: value.one_time_address,
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
  one_time_address?: string | null;
}): SalesDocumentEcommerceFields {
  const parsed = parseSalesDocumentEcommerce({
    sales_channel: source.sales_channel ?? DEFAULT_SALES_CHANNEL,
    ecommerce_order_no: source.ecommerce_order_no,
    ecommerce_buyer_name: source.ecommerce_buyer_name,
    tracking_no: source.tracking_no,
    one_time_address: source.one_time_address,
  });
  if (parsed.ok) return parsed.data;
  return {
    sales_channel: DEFAULT_SALES_CHANNEL,
    ecommerce_order_no: null,
    ecommerce_buyer_name: null,
    tracking_no: null,
    one_time_address: null,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const optionalContactId = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = String(value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  .refine((value) => value == null || UUID_RE.test(value), {
    message: "รหัสลูกค้าไม่ถูกต้อง",
  });

/**
 * Phase 19 — schema หัวเอกสารตอนสร้าง/แก้ DRAFT
 * - `contact_id` เป็น optional (Server จะ Auto-assign Dummy CPD ทีหลัง)
 * - TAX_INV + STORE บังคับ Master Data จริง
 * - ช่องทางแพลตฟอร์มบังคับเลขคำสั่งซื้อ
 *
 * ห้ามใช้ schema นี้ตอน convert/copy เอกสารเก่า — ใช้ `parseSalesDocumentEcommerce`
 */
export const salesDocumentDraftHeaderSchema = z
  .object({
    doc_type: z.string().min(1, "กรุณาเลือกประเภทเอกสาร"),
    contact_id: optionalContactId,
    sales_channel: z.enum(SALES_CHANNELS).default(DEFAULT_SALES_CHANNEL),
    ecommerce_order_no: optionalBoundedText(100, "เลขที่คำสั่งซื้อ "),
    ecommerce_buyer_name: optionalBoundedText(255, "ชื่อลูกค้าสำหรับออกบิล "),
    tracking_no: optionalBoundedText(100, "เลขพัสดุ "),
    one_time_address: optionalBoundedText(2000, "ที่อยู่ One-Time "),
  })
  .superRefine((value, ctx) => {
    if (
      isEcommercePlatformChannel(value.sales_channel) &&
      !value.ecommerce_order_no
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ecommerce_order_no"],
        message: "กรุณากรอกเลขที่คำสั่งซื้อแพลตฟอร์ม",
      });
    }
    if (
      value.doc_type === "TAX_INV" &&
      value.sales_channel === "STORE" &&
      !value.contact_id
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["contact_id"],
        message:
          "ใบกำกับภาษีเต็มรูปหน้าร้านต้องระบุลูกค้าจาก Master Data",
      });
    }
  })
  .transform((value) => {
    const isPlatform = isEcommercePlatformChannel(value.sales_channel);
    const keepWalkInSnapshot =
      isPlatform || isWalkInCashDocType(value.doc_type);
    return {
      doc_type: value.doc_type,
      contact_id: value.contact_id,
      sales_channel: value.sales_channel,
      ecommerce_order_no: isPlatform ? value.ecommerce_order_no : null,
      ecommerce_buyer_name: keepWalkInSnapshot
        ? value.ecommerce_buyer_name
        : null,
      tracking_no: isPlatform ? value.tracking_no : null,
      one_time_address: keepWalkInSnapshot ? value.one_time_address : null,
    };
  });

export type SalesDocumentDraftHeader = z.output<
  typeof salesDocumentDraftHeaderSchema
>;

export function parseSalesDocumentDraftHeader(
  input: unknown,
):
  | { ok: true; data: SalesDocumentDraftHeader }
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

  const parsed = salesDocumentDraftHeaderSchema.safeParse(raw);
  if (!parsed.success) {
    const first =
      parsed.error.issues[0]?.message ?? "ข้อมูลหัวเอกสารขายไม่ถูกต้อง";
    return { ok: false, error: first };
  }
  return { ok: true, data: parsed.data };
}
