"use server";

/**
 * Phase 7 — Stock Card (Inventory Ledger) Server Actions.
 * Zero Client-Side Fetching: Service Role (`createClient` / supabaseAdmin) only.
 *
 * Schema mapping (actual DB → Stock Card API):
 * - created_at      → transaction_date
 * - qty             → quantity
 * - trans_type      → transaction_type (IN | OUT | ADJUST)
 * - document_no     → documents.doc_no (via notes document_id=)
 *                     หรือ doc_headers.doc_no / parse จาก notes
 */

import { createClient } from "@/lib/supabase/server-admin";

export type StockTransactionType = "IN" | "OUT" | "ADJUST" | string;

export type ProductStockCardHeader = {
  id: string;
  sku: string;
  /** ชื่อสินค้า */
  name: string;
  /** รุ่น (model_code / model name) */
  model: string | null;
  size: string | null;
  color: string | null;
};

export type StockCardMovement = {
  id: string;
  transaction_date: string;
  document_no: string | null;
  transaction_type: StockTransactionType;
  /** จำนวนตาม ledger (ค่าบวกเสมอ — ทิศทางดูจาก transaction_type) */
  quantity: number;
  /** ผลกระทบต่อยอดคงเหลือ (+IN / -OUT / ±ADJUST) */
  signed_qty: number;
  running_balance: number;
  notes: string | null;
};

export type ProductStockCardData = {
  product: ProductStockCardHeader;
  /** ยอดยกมาตั้งต้น ก่อน startDate (ไม่มี startDate = 0) */
  brought_forward: number;
  movements: StockCardMovement[];
  /** ยอดคงเหลือหลังรายการสุดท้ายในช่วง */
  closing_balance: number;
};

export type GetProductStockCardResult =
  | { success: true; data: ProductStockCardData }
  | { success: false; error: string };

type ProductModelJoin = {
  model_code?: string | null;
  name?: string | null;
  short_name?: string | null;
};

type DocHeaderJoin = {
  doc_no?: string | null;
  doc_date?: string | null;
};

type LedgerRow = {
  id: string;
  created_at: string | null;
  qty: number;
  trans_type: string;
  notes: string | null;
  doc_headers: DocHeaderJoin | DocHeaderJoin[] | null;
};

function unwrapJoin<T extends object>(
  value: T | T[] | null | undefined,
): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function normalizeTransType(value: string | null | undefined): StockTransactionType {
  const t = String(value ?? "").trim().toUpperCase();
  if (t === "IN" || t === "OUT" || t === "ADJUST") return t;
  return t || "ADJUST";
}

/** ผลกระทบต่อสต็อก: IN +, OUT -, ADJUST ใช้ qty ตามเครื่องหมายที่บันทึก */
function signedQuantity(transType: StockTransactionType, qty: number): number {
  const abs = Math.abs(qty);
  if (transType === "IN") return abs;
  if (transType === "OUT") return -abs;
  return qty;
}

/**
 * Bangkok day bounds for timestamptz filters.
 * start → 00:00:00+07 · end exclusive next day 00:00:00+07
 */
function bangkokDayStart(dateStr: string): string | null {
  const d = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return `${d}T00:00:00+07:00`;
}

function bangkokNextDayStart(dateStr: string): string | null {
  const d = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return null;
  // Calendar +1 day (UTC date math on Y-M-D components only)
  const next = new Date(Date.UTC(y, m - 1, day + 1));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00+07:00`;
}

/** Phase 4 document UUID embedded in sales OUT notes */
function documentIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  const m = notes.match(/document_id=([0-9a-fA-F-]{36})/);
  return m?.[1] ?? null;
}

/** ดึงเลขที่เอกสารจากข้อความ notes เมื่อไม่มี FK */
function documentNoFromNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  const patterns = [
    /จากเอกสาร\s+([A-Za-z0-9\-_/]+)/,
    /ยกเลิกเอกสาร\s+([A-Za-z0-9\-_/]+)/,
    /เอกสาร\s+([A-Za-z0-9\-_/]+)/,
  ];
  for (const re of patterns) {
    const m = notes.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function resolveDocumentNo(
  row: LedgerRow,
  docNoByDocumentId: Map<string, string>,
): string | null {
  const phase4Id = documentIdFromNotes(row.notes);
  if (phase4Id) {
    const fromDocuments = docNoByDocumentId.get(phase4Id)?.trim();
    if (fromDocuments) return fromDocuments;
  }
  const header = unwrapJoin(row.doc_headers);
  const fromHeader = header?.doc_no?.trim();
  if (fromHeader) return fromHeader;
  return documentNoFromNotes(row.notes);
}

function sumSignedQty(
  rows: Array<{ qty: number; trans_type: string }> | null | undefined,
): number {
  let total = 0;
  for (const row of rows ?? []) {
    const type = normalizeTransType(row.trans_type);
    total += signedQuantity(type, toQty(row.qty));
  }
  return total;
}

/**
 * Stock Card ของสินค้า 1 ตัว — Header + ยอดยกมา + ความเคลื่อนไหว + running balance
 */
export async function getProductStockCard(
  productId: string,
  startDate?: string,
  endDate?: string,
): Promise<GetProductStockCardResult> {
  const id = productId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสสินค้า (productId)" };
  }

  const startBound = startDate?.trim()
    ? bangkokDayStart(startDate.trim())
    : null;
  if (startDate?.trim() && !startBound) {
    return { success: false, error: "รูปแบบ startDate ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" };
  }

  const endExclusive = endDate?.trim()
    ? bangkokNextDayStart(endDate.trim())
    : null;
  if (endDate?.trim() && !endExclusive) {
    return { success: false, error: "รูปแบบ endDate ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" };
  }

  const supabase = createClient();

  // ── Logic 1: Product Info (Header) ──────────────────────────────────────
  const { data: product, error: productError } = await supabase
    .from("products")
    .select(
      `
      id,
      sku,
      name,
      size,
      color,
      product_models (
        model_code,
        name,
        short_name
      )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (productError) {
    return {
      success: false,
      error: productError.message ?? "ดึงข้อมูลสินค้าไม่สำเร็จ",
    };
  }
  if (!product) {
    return { success: false, error: "ไม่พบสินค้าในระบบ" };
  }

  const model = unwrapJoin(
    product.product_models as ProductModelJoin | ProductModelJoin[] | null,
  );
  const modelLabel =
    model?.model_code?.trim() ||
    model?.short_name?.trim() ||
    model?.name?.trim() ||
    null;

  const header: ProductStockCardHeader = {
    id: product.id,
    sku: product.sku,
    name: product.name,
    model: modelLabel,
    size: product.size ?? null,
    color: product.color ?? null,
  };

  // ── Logic 2: Brought Forward (ยอดยกมา) ──────────────────────────────────
  // ไม่มี startDate → ยอดยกมา = 0
  // มี startDate → SUM signed qty ของรายการที่ created_at < startDate
  let broughtForward = 0;

  if (startBound) {
    const { data: priorRows, error: priorError } = await supabase
      .from("inventory_ledger")
      .select("qty, trans_type")
      .eq("product_id", id)
      .lt("created_at", startBound);

    if (priorError) {
      return {
        success: false,
        error: priorError.message ?? "คำนวณยอดยกมาไม่สำเร็จ",
      };
    }

    broughtForward = sumSignedQty(priorRows);
  }

  // ── Logic 3: Movements ในช่วงวันที่ ──────────────────────────────────────
  let movementsQuery = supabase
    .from("inventory_ledger")
    .select(
      `
      id,
      created_at,
      qty,
      trans_type,
      notes,
      doc_headers (
        doc_no,
        doc_date
      )
    `,
    )
    .eq("product_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (startBound) {
    movementsQuery = movementsQuery.gte("created_at", startBound);
  }
  if (endExclusive) {
    movementsQuery = movementsQuery.lt("created_at", endExclusive);
  }

  const { data: ledgerRows, error: ledgerError } = await movementsQuery;

  if (ledgerError) {
    return {
      success: false,
      error: ledgerError.message ?? "ดึงรายการความเคลื่อนไหวไม่สำเร็จ",
    };
  }

  const rawMovements = (ledgerRows as LedgerRow[] | null) ?? [];

  // Enrich document_no จากตาราง documents (Phase 4) เมื่อ notes มี document_id=
  const documentIds = [
    ...new Set(
      rawMovements
        .map((row) => documentIdFromNotes(row.notes))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const docNoByDocumentId = new Map<string, string>();
  if (documentIds.length > 0) {
    const { data: docs, error: docsError } = await supabase
      .from("documents")
      .select("id, doc_no")
      .in("id", documentIds);
    if (docsError) {
      return {
        success: false,
        error: docsError.message ?? "ดึงเลขที่เอกสาร (documents) ไม่สำเร็จ",
      };
    }
    for (const doc of docs ?? []) {
      if (doc.id && doc.doc_no) {
        docNoByDocumentId.set(doc.id, doc.doc_no);
      }
    }
  }

  // ── Logic 4: Running Balance ────────────────────────────────────────────
  let running = broughtForward;
  const movements: StockCardMovement[] = rawMovements.map((row) => {
    const transactionType = normalizeTransType(row.trans_type);
    const quantity = Math.abs(toQty(row.qty));
    const signed = signedQuantity(transactionType, toQty(row.qty));
    running += signed;

    return {
      id: row.id,
      transaction_date: row.created_at ?? "",
      document_no: resolveDocumentNo(row, docNoByDocumentId),
      transaction_type: transactionType,
      quantity,
      signed_qty: signed,
      running_balance: running,
      notes: row.notes ?? null,
    };
  });

  return {
    success: true,
    data: {
      product: header,
      brought_forward: broughtForward,
      movements,
      closing_balance: running,
    },
  };
}
