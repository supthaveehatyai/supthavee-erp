"use server";

import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import type { CarrierOption, DestFreightSummaryRow } from "@/types/carrier";

export type GetCarriersResult = {
  data: CarrierOption[];
  error: string | null;
};

export type CreateCarrierResult = {
  data: CarrierOption | null;
  error: string | null;
};

export type DestFreightSummaryResult = {
  data: DestFreightSummaryRow[];
  totalFreight: number;
  totalWht: number;
  error: string | null;
};

function mapCarrier(row: {
  carrier_id: string;
  carrier_code: string;
  carrier_name: string;
  tax_id: string | null;
  phone: string | null;
  default_wht_rate: number | null;
  sort_order: number | null;
}): CarrierOption {
  const rate = Number(row.default_wht_rate);
  return {
    carrier_id: row.carrier_id,
    carrier_code: row.carrier_code,
    carrier_name: row.carrier_name,
    tax_id: row.tax_id,
    phone: row.phone,
    default_wht_rate: Number.isFinite(rate) && rate >= 0 ? rate : 1,
    sort_order: Number(row.sort_order) || 0,
  };
}

export async function getActiveCarriers(): Promise<GetCarriersResult> {
  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) return { data: [], error: "Forbidden" };

    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("mst_carriers")
      .select(
        "carrier_id, carrier_code, carrier_name, tax_id, phone, default_wht_rate, sort_order",
      )
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []).map(mapCarrier), error: null };
  } catch (error: unknown) {
    return {
      data: [],
      error: error instanceof Error ? error.message : "โหลดบริษัทขนส่งไม่สำเร็จ",
    };
  }
}

export async function createCarrier(input: {
  carrierCode: string;
  carrierName: string;
  taxId?: string | null;
  phone?: string | null;
  defaultWhtRate?: number | null;
}): Promise<CreateCarrierResult> {
  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) return { data: null, error: "Forbidden" };

    const carrierCode = input.carrierCode.trim().toUpperCase();
    const carrierName = input.carrierName.trim();
    if (!carrierCode || !carrierName) {
      return { data: null, error: "กรอกรหัสและชื่อบริษัทขนส่ง" };
    }

    const supabaseAdmin = createSupabaseAdmin();
    const { data: last } = await supabaseAdmin
      .from("mst_carriers")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const sortOrder = (Number(last?.sort_order) || 0) + 10;
    const wht = Number(input.defaultWhtRate);
    const { data, error } = await supabaseAdmin
      .from("mst_carriers")
      .insert({
        carrier_code: carrierCode,
        carrier_name: carrierName,
        tax_id: input.taxId?.trim() || null,
        phone: input.phone?.trim() || null,
        default_wht_rate: Number.isFinite(wht) && wht >= 0 ? wht : 1,
        sort_order: sortOrder,
        is_active: true,
      })
      .select(
        "carrier_id, carrier_code, carrier_name, tax_id, phone, default_wht_rate, sort_order",
      )
      .single();

    if (error || !data) {
      const duplicate = error?.code === "23505";
      return {
        data: null,
        error: duplicate
          ? `รหัสขนส่ง ${carrierCode} มีอยู่แล้ว`
          : (error?.message ?? "เพิ่มบริษัทขนส่งไม่สำเร็จ"),
      };
    }
    return { data: mapCarrier(data), error: null };
  } catch (error: unknown) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "เพิ่มบริษัทขนส่งไม่สำเร็จ",
    };
  }
}

export async function listDestFreightSummary(input: {
  carrierId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  receiptStatus?: string | null;
}): Promise<DestFreightSummaryResult> {
  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) {
      return { data: [], totalFreight: 0, totalWht: 0, error: "Forbidden" };
    }

    const supabaseAdmin = createSupabaseAdmin();
    let query = supabaseAdmin
      .from("documents")
      .select(
        "id, doc_no, doc_date, contact_id, dest_freight_cost, carrier_id, carrier_tracking_no, carrier_receipt_status, carrier_receipt_no, carrier_receipt_date",
      )
      .gt("dest_freight_cost", 0)
      .order("doc_date", { ascending: false })
      .limit(300);

    if (input.carrierId?.trim()) query = query.eq("carrier_id", input.carrierId.trim());
    if (input.dateFrom?.trim()) query = query.gte("doc_date", input.dateFrom.trim());
    if (input.dateTo?.trim()) query = query.lte("doc_date", input.dateTo.trim());
    if (input.receiptStatus === "PENDING" || input.receiptStatus === "RECEIVED") {
      query = query.eq("carrier_receipt_status", input.receiptStatus);
    }

    const { data, error } = await query;
    if (error) return { data: [], totalFreight: 0, totalWht: 0, error: error.message };

    const rows = data ?? [];
    const carrierIds = [...new Set(rows.map((row) => row.carrier_id).filter(Boolean))] as string[];
    const contactIds = [...new Set(rows.map((row) => row.contact_id).filter(Boolean))] as string[];

    const [{ data: carriers }, { data: contacts }] = await Promise.all([
      carrierIds.length
        ? supabaseAdmin
            .from("mst_carriers")
            .select("carrier_id, carrier_name, default_wht_rate")
            .in("carrier_id", carrierIds)
        : Promise.resolve({ data: [] as { carrier_id: string; carrier_name: string; default_wht_rate: number | null }[] }),
      contactIds.length
        ? supabaseAdmin.from("contacts").select("id, company_name").in("id", contactIds)
        : Promise.resolve({ data: [] as { id: string; company_name: string }[] }),
    ]);

    const carrierById = new Map((carriers ?? []).map((row) => [row.carrier_id, row]));
    const contactById = new Map((contacts ?? []).map((row) => [row.id, row.company_name]));

    const mapped: DestFreightSummaryRow[] = rows
      .filter((row) => row.carrier_id)
      .map((row) => {
        const carrier = carrierById.get(row.carrier_id as string);
        const rate = Number(carrier?.default_wht_rate);
        return {
          document_id: row.id,
          doc_no: row.doc_no,
          doc_date: row.doc_date,
          vendor_name: row.contact_id ? contactById.get(row.contact_id) ?? null : null,
          carrier_id: row.carrier_id as string,
          carrier_name: carrier?.carrier_name ?? "—",
          default_wht_rate: Number.isFinite(rate) && rate >= 0 ? rate : 1,
          dest_freight_cost: Number(row.dest_freight_cost) || 0,
          carrier_tracking_no: row.carrier_tracking_no,
          carrier_receipt_status: row.carrier_receipt_status || "PENDING",
          carrier_receipt_no: row.carrier_receipt_no,
          carrier_receipt_date: row.carrier_receipt_date,
        };
      });

    const totalFreight = mapped.reduce((sum, row) => sum + row.dest_freight_cost, 0);
    const totalWht = mapped.reduce(
      (sum, row) => sum + (row.dest_freight_cost * row.default_wht_rate) / 100,
      0,
    );

    return {
      data: mapped,
      totalFreight: Math.round(totalFreight * 100) / 100,
      totalWht: Math.round(totalWht * 100) / 100,
      error: null,
    };
  } catch (error: unknown) {
    return {
      data: [],
      totalFreight: 0,
      totalWht: 0,
      error: error instanceof Error ? error.message : "โหลดสรุปค่าขนส่งไม่สำเร็จ",
    };
  }
}

export async function confirmCarrierReceipt(input: {
  documentId: string;
  receiptNo: string;
  receiptDate: string;
}): Promise<{ error: string | null }> {
  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) return { error: "Forbidden" };

    const documentId = input.documentId.trim();
    const receiptNo = input.receiptNo.trim();
    const receiptDate = input.receiptDate.trim();
    if (!documentId || !receiptNo || !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) {
      return { error: "กรอกเลขที่ใบเสร็จและวันที่ให้ครบ" };
    }

    const supabaseAdmin = createSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("documents")
      .update({
        carrier_receipt_status: "RECEIVED",
        carrier_receipt_no: receiptNo,
        carrier_receipt_date: receiptDate,
      })
      .eq("id", documentId)
      .gt("dest_freight_cost", 0);

    if (error) return { error: error.message };
    return { error: null };
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : "บันทึกใบเสร็จขนส่งไม่สำเร็จ",
    };
  }
}
