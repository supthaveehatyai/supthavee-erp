/**
 * Audit Trail JSONB change parser (shared, non-server-action).
 * Safe to import from Server Actions and (if needed) Client Components.
 */

import type { Json } from "@/src/types/supabase";

export type AuditActionLike = "INSERT" | "UPDATE" | "DELETE" | string;

/** Friendly Thai names for audited tables */
export const AUDIT_TABLE_LABELS: Record<string, string> = {
  documents: "เอกสาร",
  document_items: "รายการเอกสาร",
  inventory_ledger: "สต็อกสินค้า",
  expenses: "ค่าใช้จ่าย",
  expense_items: "รายการค่าใช้จ่าย",
  production_jobs: "ใบสั่งผลิต",
  contacts: "ลูกค้า / คู่ค้า",
  contact_persons: "ผู้ติดต่อ",
  products: "สินค้า",
  product_models: "รุ่นสินค้า",
  payments: "การชำระเงิน",
  payment_allocations: "จัดสรรชำระเงิน",
  deposit_allocations: "จัดสรรเงินมัดจำ",
  billing_notes: "ใบวางบิล",
  billing_note_items: "รายการใบวางบิล",
  audit_logs: "บันทึกตรวจสอบ",
};

/** Critical fields shown first in UPDATE summaries */
const CRITICAL_FIELDS = [
  "status",
  "payment_status",
  "is_voided",
  "grand_total",
  "total_amount",
  "net_amount",
  "net_before_vat",
  "paid_amount",
  "qty",
  "quantity",
  "signed_qty",
  "doc_no",
  "job_no",
  "job_type",
  "due_date",
  "doc_type",
] as const;

const FIELD_LABELS: Record<string, string> = {
  status: "สถานะ",
  payment_status: "สถานะชำระเงิน",
  is_voided: "ยกเลิกเอกสาร",
  grand_total: "ยอดรวมสุทธิ",
  total_amount: "ยอดรวม",
  net_amount: "ยอดสุทธิ",
  net_before_vat: "ยอดก่อน VAT",
  paid_amount: "ยอดชำระแล้ว",
  qty: "จำนวน",
  quantity: "จำนวน",
  signed_qty: "จำนวน (±)",
  doc_no: "เลขที่เอกสาร",
  job_no: "เลขที่งานผลิต",
  job_type: "ประเภทงาน",
  due_date: "วันครบกำหนด",
  doc_type: "ประเภทเอกสาร",
  details: "รายละเอียด",
  notes: "หมายเหตุ",
  company_name: "ชื่อบริษัท",
  sku: "SKU",
  name: "ชื่อ",
};

const SKIP_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "changed_at",
  "correlation_id",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(data: Json | null | undefined): Record<string, unknown> | null {
  if (data == null) return null;
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(data) ? data : null;
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 100 || !Number.isInteger(value)) {
      return value.toLocaleString("th-TH", {
        maximumFractionDigits: 2,
      });
    }
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || "—";
  }
  if (Array.isArray(value)) {
    return `[${value.length} รายการ]`;
  }
  if (isPlainObject(value)) {
    return "{…}";
  }
  return String(value);
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function getAuditTableLabel(tableName: string): string {
  const key = tableName.trim();
  return AUDIT_TABLE_LABELS[key] ?? key;
}

/**
 * Parse old_data / new_data JSONB into a concise human-readable summary.
 * Prefer critical fields (status, totals, qty) when the diff is large.
 */
export function parseAuditChangeSummary(
  action: AuditActionLike,
  oldData: Json | null,
  newData: Json | null,
  maxChanges = 4,
): string {
  const oldRec = toRecord(oldData);
  const newRec = toRecord(newData);
  const normalized = String(action).toUpperCase();

  if (normalized === "INSERT") {
    if (!newRec) return "สร้างรายการใหม่";
    const highlights: string[] = [];
    for (const key of CRITICAL_FIELDS) {
      if (newRec[key] === undefined || newRec[key] === null) continue;
      highlights.push(
        `${fieldLabel(key)} = '${formatAuditValue(newRec[key])}'`,
      );
      if (highlights.length >= 3) break;
    }
    return highlights.length > 0
      ? `สร้างรายการใหม่ · ${highlights.join(", ")}`
      : "สร้างรายการใหม่";
  }

  if (normalized === "DELETE") {
    if (!oldRec) return "ลบรายการ";
    const highlights: string[] = [];
    for (const key of CRITICAL_FIELDS) {
      if (oldRec[key] === undefined || oldRec[key] === null) continue;
      highlights.push(
        `${fieldLabel(key)} = '${formatAuditValue(oldRec[key])}'`,
      );
      if (highlights.length >= 3) break;
    }
    return highlights.length > 0
      ? `ลบรายการ · ${highlights.join(", ")}`
      : "ลบรายการ";
  }

  // UPDATE
  if (!oldRec && !newRec) return "อัปเดตข้อมูล";
  if (!oldRec && newRec) {
    return parseAuditChangeSummary("INSERT", null, newData, maxChanges);
  }
  if (oldRec && !newRec) {
    return parseAuditChangeSummary("DELETE", oldData, null, maxChanges);
  }

  const left = oldRec ?? {};
  const right = newRec ?? {};
  const allKeys = new Set([...Object.keys(left), ...Object.keys(right)]);

  type Diff = { key: string; from: unknown; to: unknown; critical: boolean };
  const diffs: Diff[] = [];

  for (const key of allKeys) {
    if (SKIP_KEYS.has(key)) continue;
    const from = left[key];
    const to = right[key];
    if (valuesEqual(from, to)) continue;
    diffs.push({
      key,
      from,
      to,
      critical: (CRITICAL_FIELDS as readonly string[]).includes(key),
    });
  }

  if (diffs.length === 0) return "อัปเดตข้อมูล (ไม่พบฟิลด์ที่เปลี่ยน)";

  diffs.sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    const ai = (CRITICAL_FIELDS as readonly string[]).indexOf(a.key);
    const bi = (CRITICAL_FIELDS as readonly string[]).indexOf(b.key);
    const aOrder = ai === -1 ? 999 : ai;
    const bOrder = bi === -1 ? 999 : bi;
    return aOrder - bOrder;
  });

  const shown = diffs.slice(0, maxChanges);
  const parts = shown.map((d) => {
    if (d.key === "status" || d.key === "payment_status") {
      return `Updated ${d.key} from '${formatAuditValue(d.from)}' to '${formatAuditValue(d.to)}'`;
    }
    if (
      d.key === "grand_total" ||
      d.key === "total_amount" ||
      d.key === "net_amount" ||
      d.key === "paid_amount"
    ) {
      return `Changed ${d.key} from ${formatAuditValue(d.from)} to ${formatAuditValue(d.to)}`;
    }
    return `เปลี่ยน${fieldLabel(d.key)} จาก '${formatAuditValue(d.from)}' เป็น '${formatAuditValue(d.to)}'`;
  });

  const remaining = diffs.length - shown.length;
  if (remaining > 0) {
    parts.push(`และอีก ${remaining} ฟิลด์`);
  }

  return parts.join(" · ");
}
