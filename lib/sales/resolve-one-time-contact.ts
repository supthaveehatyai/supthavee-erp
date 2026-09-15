/**
 * Phase 19 — SAP CPD (One-Time Customer) Dummy Contact.
 * Server-only: uses Service Role. Do not import from Client Components.
 *
 * SHOPEE / LAZADA / STORE ใช้ UUID จาก `SYSTEM_CONTACTS`
 * TIKTOK ยัง lookup จากชื่อ Contact Master (ยังไม่มี UUID ใน SYSTEM_CONTACTS)
 */

import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  SYSTEM_CONTACTS,
  isEcommercePlatformChannel,
  isWalkInCashDocType,
  resolveSystemDummyContactId,
  type SalesChannelCode,
} from "@/lib/constants/document";
import type { SalesChannel } from "@/types/document";

async function findActiveContactById(id: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data?.id) return null;
  return String(data.id);
}

async function findActiveContactByNames(
  names: readonly string[],
): Promise<string | null> {
  const supabase = createSupabaseServerClient();

  for (const name of names) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("is_active", true)
      .eq("company_name", name)
      .limit(1)
      .maybeSingle();
    if (!error && data?.id) return String(data.id);
  }

  return null;
}

async function assignSystemDummy(
  contactId: string,
  label: string,
): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const found = await findActiveContactById(contactId);
  if (!found) {
    return {
      ok: false,
      error: `ไม่พบบัญชีลูกค้ากลางระบบ ${label} (${contactId}) — ตรวจสอบ contacts.id และ is_active`,
    };
  }
  return { ok: true, contactId: found };
}

export type ResolveOneTimeCustomerResult =
  | { ok: true; contactId: string; assignedDummy: boolean }
  | { ok: false; error: string };

/**
 * ถ้ามี contact_id แล้วใช้ค่านั้น
 * ถ้าว่าง: SHOPEE / LAZADA / STORE → SYSTEM_CONTACTS; TIKTOK → ชื่อ Contact
 */
export async function resolveOneTimeCustomerContactId(input: {
  contactId?: string | null;
  salesChannel: SalesChannel | SalesChannelCode;
  docType: string;
}): Promise<ResolveOneTimeCustomerResult> {
  const existing = String(input.contactId ?? "").trim();
  if (existing) {
    return { ok: true, contactId: existing, assignedDummy: false };
  }

  const channel = input.salesChannel as SalesChannelCode;
  const systemId = resolveSystemDummyContactId(channel);
  if (systemId) {
    const dummy = await assignSystemDummy(systemId, channel);
    if (!dummy.ok) return dummy;
    return { ok: true, contactId: dummy.contactId, assignedDummy: true };
  }

  if (isEcommercePlatformChannel(channel) && channel === "TIKTOK") {
    const byName = await findActiveContactByNames([
      "ลูกค้า TikTok",
      "ลูกค้า TikTok Shop",
    ]);
    if (byName) {
      return { ok: true, contactId: byName, assignedDummy: true };
    }
    return {
      ok: false,
      error:
        "ไม่พบบัญชีลูกค้ากลาง “ลูกค้า TikTok” — กรุณาสร้าง Contact Master ที่ contacts.company_name ให้ตรงนี้",
    };
  }

  if (isWalkInCashDocType(input.docType)) {
    const dummy = await assignSystemDummy(
      SYSTEM_CONTACTS.CASH_STORE,
      "CASH_STORE",
    );
    if (!dummy.ok) return dummy;
    return { ok: true, contactId: dummy.contactId, assignedDummy: true };
  }

  return { ok: false, error: "กรุณาเลือกลูกค้า / คู่ค้า" };
}
