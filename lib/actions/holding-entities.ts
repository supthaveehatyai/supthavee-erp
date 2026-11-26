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
const LEGAL_ENTITY_COLUMNS =
  "id, entity_code, entity_type, entity_name_th, entity_name_en, tax_id, vat_status, pp30_filing_mode, vat_effective_date, registered_capital, incorporation_date, head_office_address, signatory_condition, governance_notes, primary_workspace, is_active, sort_order, created_at, updated_at";
const HOLDING_BANK_COLUMNS =
  "id, legal_entity_id, business_unit_code, workspace_key, branch_code, bank_code, bank_name, account_no, account_name, branch_name, qr_image_url, qr_storage_path, qr_label, is_qr_customer_visible, promptpay_id, payment_instruction, effective_from, effective_to, is_default_receiving, is_active, sort_order, created_at, updated_at";

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

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export async function listLegalEntitiesAction(): Promise<HoldingActionResult<LegalEntityRow[]>> {
  try {
    await requireSuperAdmin();
    const listed = await schemaAdmin()
      .schema("holding")
      .from("legal_entities")
      .select(LEGAL_ENTITY_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("entity_name_th", { ascending: true })
      .limit(100);
    if (listed.error) {
      return empty([], schemaErrorMessage(listed.error, "อ่านทะเบียนนิติบุคคลไม่สำเร็จ"), !isSchemaUnavailable(listed.error));
    }
    return empty(asRows(listed.data).map((row) => ({
      id: String(row.id),
      entity_code: String(row.entity_code ?? ""),
      entity_type: textOrNull(row.entity_type),
      entity_name_th: String(row.entity_name_th ?? ""),
      entity_name_en: textOrNull(row.entity_name_en),
      tax_id: textOrNull(row.tax_id),
      vat_status: textOrNull(row.vat_status),
      pp30_filing_mode: textOrNull(row.pp30_filing_mode),
      vat_effective_date: textOrNull(row.vat_effective_date),
      registered_capital: numberOrNull(row.registered_capital),
      incorporation_date: textOrNull(row.incorporation_date),
      head_office_address: textOrNull(row.head_office_address),
      signatory_condition: textOrNull(row.signatory_condition),
      governance_notes: textOrNull(row.governance_notes),
      primary_workspace: row.primary_workspace == null ? null : workspaceOf(row.primary_workspace),
      is_active: row.is_active !== false,
      sort_order: Number(row.sort_order ?? 0) || 0,
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
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
      entity_name_th: String(formData.get("entity_name_th") ?? "").trim(),
      entity_name_en: textOrNull(formData.get("entity_name_en")),
      tax_id: textOrNull(formData.get("tax_id")),
      primary_workspace: workspaceOf(formData.get("primary_workspace")),
      is_active: String(formData.get("is_active") ?? "true") !== "false",
    };
    if (!payload.entity_code || !payload.entity_name_th) {
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
      .select(HOLDING_BANK_COLUMNS)
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
      legal_entity_id: textOrNull(row.legal_entity_id),
      business_unit_code: textOrNull(row.business_unit_code),
      workspace_key: workspaceOf(row.workspace_key),
      branch_code: textOrNull(row.branch_code),
      bank_code: textOrNull(row.bank_code),
      bank_name: String(row.bank_name ?? ""),
      account_no: String(row.account_no ?? ""),
      account_name: String(row.account_name ?? ""),
      branch_name: textOrNull(row.branch_name),
      qr_image_url: textOrNull(row.qr_image_url),
      qr_storage_path: textOrNull(row.qr_storage_path),
      qr_label: textOrNull(row.qr_label),
      is_qr_customer_visible: row.is_qr_customer_visible === true,
      promptpay_id: textOrNull(row.promptpay_id),
      payment_instruction: textOrNull(row.payment_instruction),
      effective_from: textOrNull(row.effective_from),
      effective_to: textOrNull(row.effective_to),
      is_default_receiving: row.is_default_receiving === true,
      is_active: row.is_active !== false,
      sort_order: Number(row.sort_order ?? 10) || 10,
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
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
      legal_entity_id: textOrNull(formData.get("legal_entity_id")),
      business_unit_code: textOrNull(formData.get("business_unit_code")),
      workspace_key: workspaceOf(formData.get("workspace_key")),
      branch_code: textOrNull(formData.get("branch_code")),
      bank_code: textOrNull(formData.get("bank_code")),
      bank_name: String(formData.get("bank_name") ?? "").trim(),
      account_no: String(formData.get("account_no") ?? "").trim(),
      account_name: String(formData.get("account_name") ?? "").trim(),
      branch_name: textOrNull(formData.get("branch_name")),
      promptpay_id: textOrNull(formData.get("promptpay_id")),
      payment_instruction: textOrNull(formData.get("payment_instruction")),
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
    const note = String(formData.get("payment_instruction") ?? "").trim();
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
        payment_instruction: note || null,
        is_qr_customer_visible: Boolean(customerVisible),
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
        payment_instruction: input.payment_instruction?.trim() || null,
        is_qr_customer_visible: Boolean(input.is_qr_customer_visible),
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
      .select("*")
      .order("sort_order", { ascending: true })
      .limit(50);
    if (listed.error) {
      return empty([], schemaErrorMessage(listed.error, "อ่านสาขาเครื่องดื่มไม่สำเร็จ"), !isSchemaUnavailable(listed.error));
    }
    return empty(asRows(listed.data).map((row) => {
      const brandCode = String(row.brand_code ?? "");
      const status = String(row.branch_status ?? "");
      return {
        id: String(row.branch_code ?? ""),
        branch_code: String(row.branch_code ?? ""),
        branch_name: String(row.branch_name_th ?? ""),
        brand_code: brandCode,
        brand_name: brandCode === "LUCKY_CUP" ? "Lucky Cup" : brandCode === "CHATORN" ? "ชาทรตะโหมด" : brandCode,
        is_active: status !== "INACTIVE",
        countdown_until: row.target_open_date == null ? null : String(row.target_open_date),
      };
    }));
  } catch (error) {
    rethrowNavigation(error);
    return empty([], error instanceof Error ? error.message : "อ่านสาขาเครื่องดื่มไม่สำเร็จ", false);
  }
}
