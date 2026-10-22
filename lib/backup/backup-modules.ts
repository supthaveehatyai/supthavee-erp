/**
 * Backup catalog — ลำดับตารางเป็น Parent → Child ตาม Foreign Key
 * ห้ามสลับลำดับภายในโมดูล (ใช้ทั้ง pg_dump รายโมดูลและ JSON export)
 */

export const BACKUP_MODULE_KEYS = [
  "settings_rbac",
  "master",
  "sales_inventory",
  "finance_audit",
] as const;

export type BackupModuleKey = (typeof BACKUP_MODULE_KEYS)[number];

export type BackupModuleSelection = BackupModuleKey | "all";

/** โฟลเดอร์ Google Drive บนเครื่องที่แมปไดรฟ์ H: */
export const DEFAULT_GOOGLE_DRIVE_BACKUP_DIR =
  "H:\\My Drive\\STV_ERP_SuperApp\\Backup";

export const STORAGE_BUCKETS = [
  "document_attachments",
  "production_attachments",
  "expense_documents",
  "product_assets",
  "procurement_bills",
] as const;

export const BACKUP_MODULE_TABLES = {
  settings_rbac: [
    "system_settings",
    "system_parameters",
    "app_roles",
    "user_profiles",
    "accounting_periods",
  ],
  master: [
    "mst_uom",
    "mst_wht_rates",
    "mst_bank_accounts",
    "mst_brands",
    "mst_categories",
    "mst_colors",
    "mst_expense_categories",
    "mst_asset_categories",
    "mst_genders",
    "mst_sizes",
    "contacts",
    "contact_persons",
    "mst_carriers",
    "product_models",
    "products",
    "vendor_product_mapping",
    "product_boms",
    "technician_rates",
  ],
  sales_inventory: [
    "doc_headers",
    "doc_details",
    "documents",
    "document_items",
    "inventory_ledger",
    "production_jobs",
    "production_job_items",
    "production_job_materials",
    "production_job_operations",
  ],
  finance_audit: [
    "document_allocations",
    "billing_note_items",
    "expenses",
    "expense_installments",
    "payment_transactions",
    "payment_allocations",
    "fixed_assets",
    "asset_depreciation_ledger",
    "depreciation_ledgers",
    "approval_logs",
    "parameter_change_requests",
    "audit_logs",
  ],
};

export const BACKUP_MODULE_LABELS: Record<BackupModuleSelection, string> = {
  all: "ทั้งระบบ (Full)",
  settings_rbac: "ตั้งค่าและสิทธิ์ (Settings / RBAC)",
  master: "ข้อมูลหลัก (Master Data)",
  sales_inventory: "ขาย คลัง และผลิต (Sales / Inventory)",
  finance_audit: "การเงินและตรวจสอบ (Finance / Audit)",
};

export function isBackupModuleSelection(
  value: string,
): value is BackupModuleSelection {
  if (value === "all") return true;
  return BACKUP_MODULE_KEYS.some((key) => key === value);
}

/** `all` = รวม 4 โมดูลตามลำดับ settings → master → sales_inventory → finance_audit */
export function tablesForModule(moduleName: BackupModuleSelection): string[] {
  if (moduleName === "all") {
    const tables = BACKUP_MODULE_KEYS.flatMap((key) => [
      ...BACKUP_MODULE_TABLES[key],
    ]);
    const seen = new Set(tables);
    if (seen.size !== tables.length) {
      const duplicate = tables.find(
        (table, index) => tables.indexOf(table) !== index,
      );
      throw new Error(`Duplicate backup table: ${duplicate}`);
    }
    return tables;
  }

  const tables = BACKUP_MODULE_TABLES[moduleName];
  if (!tables) {
    throw new Error(`Unknown backup module: ${moduleName}`);
  }
  return [...tables];
}

/**
 * ลำดับกู้คืน: Master Data → Contacts → Products → Documents → Transactions → Logs
 * เรียง Parent ก่อน Child ตาม Foreign Key
 */
export const RESTORE_TABLE_ORDER = [
  "system_settings",
  "system_parameters",
  "app_roles",
  "user_profiles",
  "accounting_periods",
  "mst_uom",
  "mst_wht_rates",
  "mst_bank_accounts",
  "mst_brands",
  "mst_categories",
  "mst_colors",
  "mst_expense_categories",
  "mst_asset_categories",
  "mst_genders",
  "mst_sizes",
  "contacts",
  "contact_persons",
  "mst_carriers",
  "product_models",
  "products",
  "vendor_product_mapping",
  "product_boms",
  "technician_rates",
  "doc_headers",
  "doc_details",
  "documents",
  "document_items",
  "inventory_ledger",
  "production_jobs",
  "production_job_items",
  "production_job_materials",
  "production_job_operations",
  "document_allocations",
  "billing_note_items",
  "expenses",
  "expense_installments",
  "payment_transactions",
  "payment_allocations",
  "fixed_assets",
  "asset_depreciation_ledger",
  "depreciation_ledgers",
  "approval_logs",
  "parameter_change_requests",
  "audit_logs",
] as const;

/** Primary key ที่ใช้ตอน upsert — นอกเหนือจากนี้ใช้ `id` */
export function upsertConflictColumn(table: string): string {
  if (table === "system_parameters") return "param_key";
  if (table === "app_roles") return "role_code";
  if (table === "mst_uom") return "uom_id";
  if (table === "mst_carriers") return "carrier_id";
  return "id";
}
