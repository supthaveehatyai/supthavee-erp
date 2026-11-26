export type WorkspaceKey = "supthavee" | "fnb" | "agri" | "prop" | "holding";

export const SUPER_ADMIN_FULL_NAME = "ณัฐวัฒน์ ลิ่มวรวิวัฒน์";

export const SUPER_ADMIN_EMAIL = "nuttawat.lim@gmail.com";

export type WorkspaceRole =
  | "SUPER_ADMIN"
  | "SUPTHAVEE_STAFF"
  | "FNB_STORE_STAFF"
  | "FNB_BRANCH_MANAGER"
  | "FNB_ACCOUNTANT"
  | "PROP_MANAGER"
  | "AGRI_MANAGER";

export type UserAccessContext = {
  userId: string;
  email: string;
  fullName: string;
  displayActorName: string;
  roleCode: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  primaryWorkspace: WorkspaceKey;
  workspaceRole: WorkspaceRole;
  allowedWorkspaces: WorkspaceKey[];
  assignedBrandCode: "LUCKY_CUP" | "CHATORN" | null;
  allowedBranchCodes: string[];
  canViewFnbReports: boolean;
  canViewCostPrice: boolean;
};

export type FnbStaffDraft = {
  userId?: string;
  fullName: string;
  staffNickname: string;
  email: string;
  pin?: string;
  brandCode: "LUCKY_CUP" | "CHATORN";
  workspaceRole: "FNB_STORE_STAFF" | "FNB_BRANCH_MANAGER" | "FNB_ACCOUNTANT";
  branchCodes: string[];
};

export type FnbStaffAccountRow = {
  userId: string;
  email: string;
  fullName: string;
  staffNickname: string;
  workspaceRole: string;
  brandCode: string | null;
  branchCodes: string[];
  isActive: boolean;
};

export const HOLDING_WORKSPACE_PREFIXES = [
  "/holding",
  "/fnb",
  "/property",
  "/plantation",
] as const;

export const VAULT_DOC_CATEGORIES = [
  "DBD_CERT",
  "VAT_PP20",
  "BANK_BOOK",
  "DIRECTOR_ID",
  "CONTRACT_LICENSE",
  "LAND_DEED",
  "TAX_FINANCE",
  "OTHER",
] as const;

export type VaultDocCategory = (typeof VAULT_DOC_CATEGORIES)[number];

export const VAULT_DOC_CATEGORY_LABEL: Record<VaultDocCategory, string> = {
  DBD_CERT: "หนังสือรับรอง DBD",
  VAT_PP20: "ภ.พ.20",
  BANK_BOOK: "หน้าสมุดบัญชี",
  DIRECTOR_ID: "สำเนาบัตรกรรมการ/ทะเบียนบ้าน",
  CONTRACT_LICENSE: "สัญญาเช่า/ใบอนุญาต",
  LAND_DEED: "สำเนาโฉนด/ภ.ด.ส.",
  TAX_FINANCE: "ภาษี/งบการเงิน",
  OTHER: "อื่นๆ",
};

export type CorporateDocumentListFilter = {
  legalEntityId?: string | null;
  docCategory?: VaultDocCategory | null;
};

export type WorkspaceTheme = {
  key: WorkspaceKey;
  label: string;
  subtitle: string;
  badge: string;
  shellClass: string;
  badgeTextClass: string;
  softTextClass: string;
  activeLinkClass: string;
  headerTitle: string;
  headerSubtitle: string;
  href: string;
};

export const WORKSPACE_THEMES: Record<WorkspaceKey, WorkspaceTheme> = {
  supthavee: {
    key: "supthavee",
    label: "ทรัพย์ทวี",
    subtitle: "เสื้อผ้า บจก.ทรัพย์ทวี หาดใหญ่",
    badge: "ST",
    shellClass: "bg-blue-700",
    badgeTextClass: "text-blue-700",
    softTextClass: "text-blue-200",
    activeLinkClass: "bg-white text-blue-700",
    headerTitle: "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด",
    headerSubtitle: "ระบบบริหารจัดการทรัพยากรองค์กร",
    href: "/dashboard",
  },
  fnb: {
    key: "fnb",
    label: "เครื่องดื่ม",
    subtitle: "Lucky Cup & ชาทร",
    badge: "FB",
    shellClass: "bg-red-700",
    badgeTextClass: "text-red-700",
    softTextClass: "text-red-100",
    activeLinkClass: "bg-white text-red-700",
    headerTitle: "ธุรกิจเครื่องดื่ม",
    headerSubtitle: "Lucky Cup และ ชาทรตะโหมด",
    href: "/fnb",
  },
  agri: {
    key: "agri",
    label: "เกษตรสวนยาง",
    subtitle: "สงขลา และ สกลนคร",
    badge: "AG",
    shellClass: "bg-emerald-800",
    badgeTextClass: "text-emerald-800",
    softTextClass: "text-emerald-100",
    activeLinkClass: "bg-white text-emerald-800",
    headerTitle: "ธุรกิจเกษตรสวนยางพารา",
    headerSubtitle: "โซนสงขลา และสกลนคร",
    href: "/plantation",
  },
  prop: {
    key: "prop",
    label: "บ้านเช่า/ที่ดิน",
    subtitle: "เช่าและภาษีที่ดิน",
    badge: "PR",
    shellClass: "bg-amber-950",
    badgeTextClass: "text-amber-950",
    softTextClass: "text-amber-100",
    activeLinkClass: "bg-white text-amber-950",
    headerTitle: "บ้านเช่า ที่ดินเช่า และภาษีที่ดิน",
    headerSubtitle: "สงขลา และกรุงเทพฯ",
    href: "/property",
  },
  holding: {
    key: "holding",
    label: "ศูนย์โฮลดิ้ง",
    subtitle: "คลังเอกสารบริษัท",
    badge: "HD",
    shellClass: "bg-slate-900",
    badgeTextClass: "text-slate-900",
    softTextClass: "text-slate-300",
    activeLinkClass: "bg-white text-slate-900",
    headerTitle: "ศูนย์ผู้บริหารและคลังเอกสารบริษัท",
    headerSubtitle: "สิทธิ์ข้ามบริษัทและสมุดบัญชีทุกธุรกิจ",
    href: "/holding",
  },
};

export type LegalEntityRow = {
  id: string;
  entity_code: string;
  entity_type: string | null;
  entity_name_th: string;
  entity_name_en: string | null;
  tax_id: string | null;
  vat_status: string | null;
  pp30_filing_mode: string | null;
  vat_effective_date: string | null;
  registered_capital: number | null;
  incorporation_date: string | null;
  head_office_address: string | null;
  signatory_condition: string | null;
  governance_notes: string | null;
  primary_workspace: WorkspaceKey | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BusinessUnitRow = {
  bu_code: string;
  workspace_key: WorkspaceKey;
  bu_name_th: string;
  default_legal_entity_id: string | null;
  vat_treatment: string | null;
  theme_color_hex: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type HoldingBankAccountRow = {
  id: string;
  legal_entity_id: string | null;
  business_unit_code: string | null;
  workspace_key: WorkspaceKey;
  branch_code: string | null;
  bank_code: string | null;
  bank_name: string;
  account_no: string;
  account_name: string;
  branch_name: string | null;
  qr_image_url: string | null;
  qr_storage_path: string | null;
  qr_label: string | null;
  is_qr_customer_visible: boolean;
  promptpay_id: string | null;
  payment_instruction: string | null;
  effective_from: string | null;
  effective_to: string | null;
  is_default_receiving: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type HoldingBankQrSettingsInput = {
  id: string;
  qr_label: string | null;
  payment_instruction: string | null;
  is_qr_customer_visible: boolean;
};

export type SignedDocumentLink = {
  url: string | null;
  downloadFileName: string | null;
};

export type CorporateDocumentRow = {
  id: string;
  legal_entity_id: string | null;
  entity_name: string | null;
  workspace_key: WorkspaceKey;
  doc_category: VaultDocCategory;
  title: string;
  doc_ref_no: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  file_storage_path: string;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  tags: string[];
  notes: string | null;
  uploaded_by: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type FnbBranchRow = {
  id: string;
  branch_code: string;
  branch_name: string;
  brand_code: string;
  brand_name: string | null;
  is_active: boolean;
  countdown_until: string | null;
};

export type LineChannelRow = {
  channel_code: string;
  workspace_key: WorkspaceKey;
  oa_basic_id: string | null;
  channel_secret: string | null;
  channel_access_token: string | null;
  liff_id: string | null;
  default_bank_account_id: string | null;
  is_active: boolean;
};

export type LiffRegistrationRow = {
  id: string;
  line_user_id: string;
  display_name: string | null;
  channel_code: string;
  workspace_key: WorkspaceKey | null;
  status: string;
  assigned_brand_code: string | null;
  branch_code: string | null;
  staff_nickname: string | null;
  is_active: boolean;
  created_at: string;
};

export type HoldingActionResult<T> = {
  data: T;
  error: string | null;
  schemaReady: boolean;
};
