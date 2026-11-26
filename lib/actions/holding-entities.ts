"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { isSchemaUnavailable, schemaAdmin, schemaErrorMessage, SCHEMA_SETUP_MESSAGE } from "@/lib/holding/schema-db";
import type {
  FnbBranchRow,
  HoldingActionResult,
  HoldingBankAccountRow,
  HoldingBankQrSettingsInput,
  LegalEntityRow,
  LiffRegistrationRow,
  LineChannelRow,
  WorkspaceKey,
} from "@/types/holding";

const WORKSPACES = new Set<WorkspaceKey>(["supthavee", "fnb", "agri", "prop", "holding"]);

function rethrowNavigation(error: unknown): void {
  const digest = error && typeof error === "object" && "digest" in error
    ? String((error as { digest?: unknown }).digest ?? "")
    : "";
  if (digest.includes("NEXT_REDIRECT") || digest.includes("NEXT_HTTP_ERROR_FALLBACK")) throw error;
}

function empty<T>(data: T, error: string | null = null, schemaReady = true): HoldingActionResult<T> {
  return { data, error, schemaReady };
}

function asRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data)
    ? data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

function workspaceOf(value: unknown): WorkspaceKey {
  const key = String(value ?? "holding");
  return WORKSPACES.has(key as WorkspaceKey) ? (key as WorkspaceKey) : "holding";
}

function asciiToken(value: string, fallback: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned.slice(0, 40) || fallback;
}

export async function listLegalEntitiesAction(): Promise<HoldingActionResult<LegalEntityRow[]>> {
  try {
    await requireSuperAdmin();
    const listed = await schemaAdmin()
      .schema("holding")
      .from("legal_entities")
      .select("id, entity_code, legal_name, tax_id, workspace_key, is_active")
      .order("legal_name", { ascending: true })
      .limit(100);
    if (listed.error) {
      return empty([], schemaErrorMessage(listed.error, "อ่านทะเบียนนิติบุคคลไม่สำเร็จ"), !isSchemaUnavailable(listed.error));
    }
    return empty(asRows(listed.data).map((row) => ({
      id: String(row.id),
      entity_code: String(row.entity_code ?? ""),
      legal_name: String(row.legal_name ?? ""),
      tax_id: row.tax_id == null ? null : String(row.tax_id),
      workspace_key: row.workspace_key == null ? null : workspaceOf(row.workspace_key),
      is_active: row.is_active !== false,
    })));
  } catch (error) {
    rethrowNavigation(error);
    return empty([], error instanceof Error ? error.message : "อ่านทะเบียนนิติบุคคลไม่สำเร็จ", false);
  }
}

export async function saveLegalEntityAction(
  formData: FormData,
): Promise<HoldingActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const payload = {
      entity_code: asciiToken(String(formData.get("entity_code") ?? ""), ""),
      legal_name: String(formData.get("legal_name") ?? "").trim(),
      tax_id: String(formData.get("tax_id") ?? "").trim() || null,
      workspace_key: workspaceOf(formData.get("workspace_key")),
      is_active: String(formData.get("is_active") ?? "true") !== "false",
    };
    if (!payload.entity_code || !payload.legal_name) {
      return empty({ ok: false }, "กรุณาระบุรหัส ASCII และชื่อนิติบุคคล");
    }
    const table = schemaAdmin().schema("holding").from("legal_entities");
    const saved = id
      ? await table.update(payload).eq("id", id)
      : await table.insert(payload);
    if (saved.error) {
      return empty({ ok: false }, schemaErrorMessage(saved.error, "บันทึกนิติบุคคลไม่สำเร็จ"), !isSchemaUnavailable(saved.error));
    }
    revalidatePath("/holding/entities");
    return empty({ ok: true });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ ok: false }, error instanceof Error ? error.message : "บันทึกนิติบุคคลไม่สำเร็จ", false);
  }
}

export async function listHoldingBankAccountsAction(
  workspaceKey?: string,
): Promise<HoldingActionResult<HoldingBankAccountRow[]>> {
  try {
    await requireSuperAdmin();
    let query = schemaAdmin()
      .schema("holding")
      .from("bank_accounts")
      .select("id, entity_id, workspace_key, bank_name, account_no, account_name, branch_name, promptpay_note, qr_label, qr_image_url, qr_storage_path, is_qr_customer_visible, is_active, is_default_receiving, sort_order")
      .order("sort_order", { ascending: true })
      .limit(200);
    if (workspaceKey && WORKSPACES.has(workspaceKey as WorkspaceKey)) {
      query = query.eq("workspace_key", workspaceKey);
    }
    const listed = await query;
    if (listed.error) {
      return empty([], schemaErrorMessage(listed.error, "อ่านสมุดบัญชีไม่สำเร็จ"), !isSchemaUnavailable(listed.error));
    }
    return empty(asRows(listed.data).map((row) => ({
      id: String(row.id),
      entity_id: row.entity_id == null ? null : String(row.entity_id),
      workspace_key: workspaceOf(row.workspace_key),
      bank_name: String(row.bank_name ?? ""),
      account_no: String(row.account_no ?? ""),
      account_name: String(row.account_name ?? ""),
      branch_name: row.branch_name == null ? null : String(row.branch_name),
      promptpay_note: row.promptpay_note == null ? null : String(row.promptpay_note),
      qr_label: row.qr_label == null ? null : String(row.qr_label),
      qr_image_url: row.qr_image_url == null ? null : String(row.qr_image_url),
      qr_storage_path: row.qr_storage_path == null ? null : String(row.qr_storage_path),
      is_qr_customer_visible: row.is_qr_customer_visible === true,
      is_active: row.is_active !== false,
      is_default_receiving: row.is_default_receiving === true,
      sort_order: Number(row.sort_order ?? 10) || 10,
    })));
  } catch (error) {
    rethrowNavigation(error);
    return empty([], error instanceof Error ? error.message : "อ่านสมุดบัญชีไม่สำเร็จ", false);
  }
}

export async function saveHoldingBankAccountAction(
  formData: FormData,
): Promise<HoldingActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const payload = {
      entity_id: String(formData.get("entity_id") ?? "").trim() || null,
      workspace_key: workspaceOf(formData.get("workspace_key")),
      bank_name: String(formData.get("bank_name") ?? "").trim(),
      account_no: String(formData.get("account_no") ?? "").trim(),
      account_name: String(formData.get("account_name") ?? "").trim(),
      branch_name: String(formData.get("branch_name") ?? "").trim() || null,
      promptpay_note: String(formData.get("promptpay_note") ?? "").trim() || null,
      is_active: String(formData.get("is_active") ?? "true") !== "false",
      is_default_receiving: String(formData.get("is_default_receiving") ?? "") === "true",
      sort_order: Number(formData.get("sort_order") ?? 10) || 10,
    };
    if (!payload.bank_name || !payload.account_no || !payload.account_name) {
      return empty({ ok: false }, "กรุณาระบุธนาคาร เลขบัญชี และชื่อบัญชี");
    }
    const table = schemaAdmin().schema("holding").from("bank_accounts");
    const saved = id ? await table.update(payload).eq("id", id) : await table.insert(payload);
    if (saved.error) {
      return empty({ ok: false }, schemaErrorMessage(saved.error, "บันทึกบัญชีไม่สำเร็จ"), !isSchemaUnavailable(saved.error));
    }
    revalidatePath("/holding/bank-accounts");
    return empty({ ok: true });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ ok: false }, error instanceof Error ? error.message : "บันทึกบัญชีไม่สำเร็จ", false);
  }
}

export async function uploadHoldingBankQrAction(
  formData: FormData,
): Promise<HoldingActionResult<{ url: string | null }>> {
  try {
    await requireSuperAdmin();
    const bankId = String(formData.get("bank_account_id") ?? "").trim();
    const workspace = asciiToken(String(formData.get("workspace_key") ?? "holding"), "holding");
    const qrLabel = String(formData.get("qr_label") ?? "").trim();
    const note = String(formData.get("promptpay_note") ?? "").trim();
    const customerVisible = String(formData.get("is_qr_customer_visible") ?? "") === "true";
    const file = formData.get("file");
    if (!bankId) return empty({ url: null }, "ไม่พบรหัสบัญชี");
    if (!(file instanceof File) || file.size <= 0 || !file.type.startsWith("image/")) {
      return empty({ url: null }, "กรุณาเลือกไฟล์รูป QR");
    }
    const path = `holding/${workspace}/${crypto.randomUUID()}.webp`;
    const admin = schemaAdmin();
    const uploaded = await admin.storage.from("payment_qr_codes").upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: "image/webp",
      upsert: false,
    });
    if (uploaded.error) return empty({ url: null }, uploaded.error.message ?? "อัปโหลด QR ไม่สำเร็จ");
    const publicUrl = admin.storage.from("payment_qr_codes").getPublicUrl(path).data.publicUrl;
    const updated = await admin
      .schema("holding")
      .from("bank_accounts")
      .update({
        qr_storage_path: path,
        qr_image_url: publicUrl,
        qr_label: qrLabel || null,
        promptpay_note: note || null,
        is_qr_customer_visible: customerVisible,
      })
      .eq("id", bankId);
    if (updated.error) {
      return empty({ url: null }, schemaErrorMessage(updated.error, "บันทึก QR ไม่สำเร็จ"), !isSchemaUnavailable(updated.error));
    }
    revalidatePath("/holding/bank-accounts");
    return empty({ url: publicUrl });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ url: null }, error instanceof Error ? error.message : "อัปโหลด QR ไม่สำเร็จ", false);
  }
}

export async function updateHoldingBankQrSettingsAction(
  input: HoldingBankQrSettingsInput,
): Promise<HoldingActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const id = input.id.trim();
    if (!id) return empty({ ok: false }, "ไม่พบรหัสบัญชี");
    const updated = await schemaAdmin()
      .schema("holding")
      .from("bank_accounts")
      .update({
        qr_label: input.qr_label?.trim() || null,
        promptpay_note: input.promptpay_note?.trim() || null,
        is_qr_customer_visible: input.is_qr_customer_visible === true,
      })
      .eq("id", id);
    if (updated.error) {
      return empty({ ok: false }, schemaErrorMessage(updated.error, "บันทึกตั้งค่า QR ไม่สำเร็จ"), !isSchemaUnavailable(updated.error));
    }
    revalidatePath("/holding/bank-accounts");
    return empty({ ok: true });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ ok: false }, error instanceof Error ? error.message : "บันทึกตั้งค่า QR ไม่สำเร็จ", false);
  }
}

export async function listLineChannelsAction(): Promise<HoldingActionResult<LineChannelRow[]>> {
  try {
    await requireSuperAdmin();
    const listed = await schemaAdmin()
      .schema("holding")
      .from("line_channels")
      .select("channel_code, workspace_key, oa_basic_id, channel_secret, channel_access_token, liff_id, default_bank_account_id, is_active")
      .order("channel_code", { ascending: true })
      .limit(50);
    if (listed.error) {
      return empty([], schemaErrorMessage(listed.error, "อ่านช่อง LINE ไม่สำเร็จ"), !isSchemaUnavailable(listed.error));
    }
    return empty(asRows(listed.data).map((row) => ({
      channel_code: String(row.channel_code ?? ""),
      workspace_key: workspaceOf(row.workspace_key),
      oa_basic_id: row.oa_basic_id == null ? null : String(row.oa_basic_id),
      channel_secret: row.channel_secret == null ? null : String(row.channel_secret),
      channel_access_token: row.channel_access_token == null ? null : String(row.channel_access_token),
      liff_id: row.liff_id == null ? null : String(row.liff_id),
      default_bank_account_id: row.default_bank_account_id == null ? null : String(row.default_bank_account_id),
      is_active: row.is_active !== false,
    })));
  } catch (error) {
    rethrowNavigation(error);
    return empty([], error instanceof Error ? error.message : "อ่านช่อง LINE ไม่สำเร็จ", false);
  }
}

export async function saveLineChannelAction(
  formData: FormData,
): Promise<HoldingActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const channelCode = asciiToken(String(formData.get("channel_code") ?? ""), "");
    if (!channelCode) return empty({ ok: false }, "รหัสช่องต้องเป็นภาษาอังกฤษหรือตัวเลข");
    const payload = {
      channel_code: channelCode,
      workspace_key: workspaceOf(formData.get("workspace_key")),
      oa_basic_id: String(formData.get("oa_basic_id") ?? "").trim() || null,
      channel_secret: String(formData.get("channel_secret") ?? "").trim() || null,
      channel_access_token: String(formData.get("channel_access_token") ?? "").trim() || null,
      liff_id: String(formData.get("liff_id") ?? "").trim() || null,
      default_bank_account_id: String(formData.get("default_bank_account_id") ?? "").trim() || null,
      is_active: String(formData.get("is_active") ?? "true") !== "false",
    };
    const saved = await schemaAdmin().schema("holding").from("line_channels").insert(payload);
    if (saved.error && /duplicate|23505/i.test(saved.error.message ?? "")) {
      const updated = await schemaAdmin()
        .schema("holding")
        .from("line_channels")
        .update(payload)
        .eq("channel_code", channelCode);
      if (updated.error) {
        return empty({ ok: false }, schemaErrorMessage(updated.error, "บันทึกช่อง LINE ไม่สำเร็จ"), !isSchemaUnavailable(updated.error));
      }
    } else if (saved.error) {
      return empty({ ok: false }, schemaErrorMessage(saved.error, "บันทึกช่อง LINE ไม่สำเร็จ"), !isSchemaUnavailable(saved.error));
    }
    revalidatePath("/holding/line-access");
    return empty({ ok: true });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ ok: false }, error instanceof Error ? error.message : "บันทึกช่อง LINE ไม่สำเร็จ", false);
  }
}

export async function listLiffRegistrationsAction(): Promise<HoldingActionResult<LiffRegistrationRow[]>> {
  try {
    await requireSuperAdmin();
    const listed = await schemaAdmin()
      .schema("holding")
      .from("liff_user_registrations")
      .select("id, line_user_id, display_name, channel_code, workspace_key, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (listed.error) {
      return empty([], schemaErrorMessage(listed.error, "อ่านคำขอ LIFF ไม่สำเร็จ"), !isSchemaUnavailable(listed.error));
    }
    return empty(asRows(listed.data).map((row) => ({
      id: String(row.id),
      line_user_id: String(row.line_user_id ?? ""),
      display_name: row.display_name == null ? null : String(row.display_name),
      channel_code: String(row.channel_code ?? ""),
      workspace_key: row.workspace_key == null ? null : workspaceOf(row.workspace_key),
      status: String(row.status ?? "PENDING"),
      created_at: String(row.created_at ?? ""),
    })));
  } catch (error) {
    rethrowNavigation(error);
    return empty([], error instanceof Error ? error.message : "อ่านคำขอ LIFF ไม่สำเร็จ", false);
  }
}

export async function approveLiffRegistrationAction(
  formData: FormData,
): Promise<HoldingActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const status = String(formData.get("status") ?? "APPROVED").trim();
    if (!id) return empty({ ok: false }, "ไม่พบคำขอ");
    const updated = await schemaAdmin()
      .schema("holding")
      .from("liff_user_registrations")
      .update({
        status,
        workspace_key: workspaceOf(formData.get("workspace_key")),
      })
      .eq("id", id);
    if (updated.error) {
      return empty({ ok: false }, schemaErrorMessage(updated.error, "อนุมัติสิทธิ์ไม่สำเร็จ"), !isSchemaUnavailable(updated.error));
    }
    revalidatePath("/holding/line-access");
    return empty({ ok: true });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ ok: false }, error instanceof Error ? error.message : "อนุมัติสิทธิ์ไม่สำเร็จ", false);
  }
}

export async function submitLiffRegistrationAction(
  formData: FormData,
): Promise<HoldingActionResult<{ ok: boolean }>> {
  try {
    const lineUserId = asciiToken(String(formData.get("line_user_id") ?? ""), "");
    const channelCode = asciiToken(String(formData.get("channel_code") ?? ""), "");
    if (!lineUserId || !channelCode) {
      return empty({ ok: false }, "กรุณาระบุ LINE user และรหัสช่องเป็นภาษาอังกฤษ");
    }
    const inserted = await schemaAdmin().schema("holding").from("liff_user_registrations").insert({
      line_user_id: lineUserId,
      display_name: String(formData.get("display_name") ?? "").trim() || null,
      channel_code: channelCode,
      workspace_key: String(formData.get("workspace_key") ?? "").trim() || null,
      status: "PENDING",
    });
    if (inserted.error) {
      return empty(
        { ok: false },
        isSchemaUnavailable(inserted.error) ? SCHEMA_SETUP_MESSAGE : inserted.error.message ?? "ส่งคำขอไม่สำเร็จ",
        !isSchemaUnavailable(inserted.error),
      );
    }
    return empty({ ok: true });
  } catch (error) {
    rethrowNavigation(error);
    return empty({ ok: false }, error instanceof Error ? error.message : "ส่งคำขอไม่สำเร็จ", false);
  }
}

export async function listFnbBranchesAction(): Promise<HoldingActionResult<FnbBranchRow[]>> {
  try {
    await requireSuperAdmin();
    const listed = await schemaAdmin()
      .schema("fnb")
      .from("branches")
      .select("id, branch_code, branch_name, brand_code, brand_name, is_active, countdown_until")
      .order("branch_code", { ascending: true })
      .limit(50);
    if (listed.error) {
      return empty([], schemaErrorMessage(listed.error, "อ่านสาขาเครื่องดื่มไม่สำเร็จ"), !isSchemaUnavailable(listed.error));
    }
    return empty(asRows(listed.data).map((row) => ({
      id: String(row.id ?? row.branch_code ?? ""),
      branch_code: String(row.branch_code ?? ""),
      branch_name: String(row.branch_name ?? ""),
      brand_code: String(row.brand_code ?? ""),
      brand_name: row.brand_name == null ? null : String(row.brand_name),
      is_active: row.is_active !== false,
      countdown_until: row.countdown_until == null ? null : String(row.countdown_until),
    })));
  } catch (error) {
    rethrowNavigation(error);
    return empty([], error instanceof Error ? error.message : "อ่านสาขาเครื่องดื่มไม่สำเร็จ", false);
  }
}
