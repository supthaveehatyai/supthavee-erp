export type WorkspaceKey = "supthavee" | "fnb" | "agri" | "prop" | "holding";

export const SUPER_ADMIN_FULL_NAME = "ณัฐวัฒน์ ลิ่มวรวิวัฒน์";

export const HOLDING_WORKSPACE_PREFIXES = [
  "/holding",
  "/fnb",
  "/property",
  "/plantation",
] as const;

export const VAULT_CATEGORIES = [
  "หนังสือรับรอง DBD",
  "ภ.พ.20",
  "หน้าสมุดบัญชี",
  "สำเนาบัตรกรรมการ/ทะเบียนบ้าน",
  "สัญญาเช่า/ใบอนุญาต",
  "สำเนาโฉนด/ภ.ด.ส.",
  "ภาษี/งบการเงิน",
  "อื่นๆ",
] as const;

export type VaultCategory = (typeof VAULT_CATEGORIES)[number];

export const VAULT_CATEGORY_SLUG: Record<VaultCategory, string> = {
  "หนังสือรับรอง DBD": "dbd",
  "ภ.พ.20": "pp20",
  "หน้าสมุดบัญชี": "passbook",
  "สำเนาบัตรกรรมการ/ทะเบียนบ้าน": "id-house",
  "สัญญาเช่า/ใบอนุญาต": "lease",
  "สำเนาโฉนด/ภ.ด.ส.": "title-deed",
  "ภาษี/งบการเงิน": "tax",
  "อื่นๆ": "other",
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
  legal_name: string;
  tax_id: string | null;
  workspace_key: WorkspaceKey | null;
  is_active: boolean;
};

export type BusinessUnitRow = {
  id: string;
  entity_id: string | null;
  unit_code: string;
  unit_name: string;
  workspace_key: WorkspaceKey;
  is_active: boolean;
};

export type HoldingBankAccountRow = {
  id: string;
  entity_id: string | null;
  workspace_key: WorkspaceKey;
  bank_name: string;
  account_no: string;
  account_name: string;
  branch_name: string | null;
  promptpay_note: string | null;
  qr_image_url: string | null;
  qr_storage_path: string | null;
  is_active: boolean;
  is_default_receiving: boolean;
  sort_order: number;
};

export type CorporateDocumentRow = {
  id: string;
  entity_id: string | null;
  entity_name: string | null;
  workspace_key: WorkspaceKey;
  category: string;
  title: string;
  storage_path: string;
  mime_type: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
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
  created_at: string;
};

export type HoldingActionResult<T> = {
  data: T;
  error: string | null;
  schemaReady: boolean;
};
