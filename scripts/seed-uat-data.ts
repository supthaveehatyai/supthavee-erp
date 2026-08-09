/**
 * Phase 12 — UAT Seed Script
 *
 * อัดฉีดข้อมูลจำลองสำหรับ User Acceptance Testing
 * รันด้วย Service Role Key (bypass RLS) — ไม่ผ่าน Client
 *
 * Usage:
 *   npx tsx scripts/seed-uat-data.ts
 *
 * Env (โหลดจาก .env.development เป็นหลัก):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Schema notes:
 *   - contacts ใช้ contact_type = 'Customer' | 'Vendor' (ไม่มี is_customer/is_vendor)
 *   - inventory_ledger ไม่มี document_ref → เก็บ 'UAT-INIT-001' ใน notes
 */

import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UAT_PREFIX = "[UAT]";
const UAT_DOC_REF = "UAT-INIT-001";
const UAT_SKU_PREFIX = "UAT-SKU-";
const BROUGHT_FORWARD_QTY = 100;

const UAT_CUSTOMERS = [
  {
    company_name: `${UAT_PREFIX} ร้านกีฬาหาดใหญ่ จำกัด`,
    tax_id: "0123456789012",
    phone: "074-111-001",
    address: "123 ถนนเพชรเกษม หาดใหญ่ สงขลา 90110",
    customer_type: "นิติบุคคล",
    default_price_tier: "Wholesale",
    credit_days: 30,
  },
  {
    company_name: `${UAT_PREFIX} คุณสมชาย ทดสอบ`,
    tax_id: "1234567890123",
    phone: "081-222-0002",
    address: "45 ซอยทดสอบ 1 หาดใหญ่ สงขลา 90110",
    customer_type: "บุคคลธรรมดา",
    default_price_tier: "Retail",
    credit_days: 0,
  },
] as const;

const UAT_VENDORS = [
  {
    company_name: `${UAT_PREFIX} โรงงานเสื้อกีฬา ABC`,
    tax_id: "0105558888999",
    phone: "02-333-0003",
    address: "88 นิคมอุตสาหกรรม บางนา กรุงเทพฯ 10260",
    customer_type: "นิติบุคคล",
    default_price_tier: "Wholesale",
    credit_days: 45,
  },
  {
    company_name: `${UAT_PREFIX} ซัพพลายเออร์ถ้วยรางวัล XYZ`,
    tax_id: "0105557777666",
    phone: "02-444-0004",
    address: "9 ถนนลาดพร้าว กรุงเทพฯ 10310",
    customer_type: "นิติบุคคล",
    default_price_tier: "Wholesale",
    credit_days: 30,
  },
] as const;

const UAT_EXPENSE_CATEGORIES = [
  { category_name: "ค่าไฟฟ้า", description: `${UAT_PREFIX} ค่าไฟฟ้า / สาธารณูปโภค` },
  { category_name: "ค่าขนส่ง", description: `${UAT_PREFIX} ค่าขนส่งสินค้า / ค่าจัดส่ง` },
  { category_name: "เงินเดือนพนักงาน", description: `${UAT_PREFIX} เงินเดือนและค่าจ้างพนักงาน` },
  {
    category_name: "ค่าวัสดุสิ้นเปลือง",
    description: `${UAT_PREFIX} วัสดุสำนักงานและของใช้สิ้นเปลือง`,
  },
] as const;

const UAT_PRODUCTS = [
  {
    sku: `${UAT_SKU_PREFIX}001`,
    name: `${UAT_PREFIX} เสื้อโปโล UAT ขาว M`,
    short_name: "UAT Polo WHT M",
    color: "WHT",
    size: "M",
    cost_price: 150,
    retail_price: 299,
    wholesale_price: 220,
  },
  {
    sku: `${UAT_SKU_PREFIX}002`,
    name: `${UAT_PREFIX} กางเกงกีฬา UAT ดำ L`,
    short_name: "UAT Short BLK L",
    color: "BLK",
    size: "L",
    cost_price: 180,
    retail_price: 350,
    wholesale_price: 260,
  },
  {
    sku: `${UAT_SKU_PREFIX}003`,
    name: `${UAT_PREFIX} ถุงเท้า UAT กรมท่า Freesize`,
    short_name: "UAT Sock NVY FS",
    color: "NVY",
    size: "FS",
    cost_price: 25,
    retail_price: 79,
    wholesale_price: 55,
  },
] as const;

// ---------------------------------------------------------------------------
// Env + client
// ---------------------------------------------------------------------------

function loadEnvFiles(): void {
  const root = process.cwd();
  // Prefer local UAT target (.env.development) then fallbacks
  loadDotenv({ path: resolve(root, ".env.development") });
  loadDotenv({ path: resolve(root, ".env.local"), override: false });
  loadDotenv({ path: resolve(root, ".env"), override: false });
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing env ${name} — ตั้งค่าใน .env.development แล้วรันใหม่`,
    );
  }
  return value;
}

function createAdminClient(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function assertOk(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Cleanup (idempotent re-runs)
// ---------------------------------------------------------------------------

async function cleanupUatData(supabase: SupabaseClient): Promise<void> {
  console.log("\n🧹 [1/4] Cleaning previous UAT data…");

  // 1) Ledger rows tagged with UAT-INIT-001
  const { data: ledgerRows, error: ledgerSelectError } = await supabase
    .from("inventory_ledger")
    .select("id")
    .ilike("notes", `%${UAT_DOC_REF}%`);
  assertOk(ledgerSelectError, "Select UAT inventory_ledger");

  const ledgerIds = (ledgerRows ?? []).map((row) => row.id as string);
  if (ledgerIds.length > 0) {
    const { error } = await supabase
      .from("inventory_ledger")
      .delete()
      .in("id", ledgerIds);
    assertOk(error, "Delete UAT inventory_ledger");
  }
  console.log(`   • inventory_ledger deleted: ${ledgerIds.length}`);

  // 2) UAT products (SKU prefix) — after ledger FK cleared
  const { data: productRows, error: productSelectError } = await supabase
    .from("products")
    .select("id, sku")
    .ilike("sku", `${UAT_SKU_PREFIX}%`);
  assertOk(productSelectError, "Select UAT products");

  const productIds = (productRows ?? []).map((row) => row.id as string);
  if (productIds.length > 0) {
    // Also clear any leftover ledger pointing at these products
    const { error: leftoverLedgerError } = await supabase
      .from("inventory_ledger")
      .delete()
      .in("product_id", productIds);
    assertOk(leftoverLedgerError, "Delete leftover ledger for UAT products");

    const { error } = await supabase.from("products").delete().in("id", productIds);
    assertOk(error, "Delete UAT products");
  }
  console.log(`   • products deleted: ${productIds.length}`);

  // 3) Expense categories tagged [UAT] in description only (อย่าลบหมวดระบบจริง)
  const { data: categoryRows, error: categorySelectError } = await supabase
    .from("mst_expense_categories")
    .select("id, category_name")
    .ilike("description", `%${UAT_PREFIX}%`);
  assertOk(categorySelectError, "Select UAT expense categories");

  const categoryIds = (categoryRows ?? []).map((row) => row.id as string);
  if (categoryIds.length > 0) {
    const { error } = await supabase
      .from("mst_expense_categories")
      .delete()
      .in("id", categoryIds);
    if (error) {
      console.warn(
        `   ⚠ mst_expense_categories delete skipped (${error.message}) — อาจถูกอ้างอิงโดย expenses`,
      );
    } else {
      console.log(`   • mst_expense_categories deleted: ${categoryIds.length}`);
    }
  } else {
    console.log("   • mst_expense_categories deleted: 0");
  }

  // 4) UAT contacts (company_name starts with [UAT])
  const { data: contactRows, error: contactSelectError } = await supabase
    .from("contacts")
    .select("id, company_name")
    .ilike("company_name", `${UAT_PREFIX}%`);
  assertOk(contactSelectError, "Select UAT contacts");

  const contactIds = (contactRows ?? []).map((row) => row.id as string);
  if (contactIds.length > 0) {
    const { error } = await supabase.from("contacts").delete().in("id", contactIds);
    if (error) {
      console.warn(
        `   ⚠ contacts delete skipped (${error.message}) — อาจถูกอ้างอิงโดย documents`,
      );
    } else {
      console.log(`   • contacts deleted: ${contactIds.length}`);
    }
  } else {
    console.log("   • contacts deleted: 0");
  }
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedContacts(supabase: SupabaseClient): Promise<{
  customers: number;
  vendors: number;
}> {
  console.log("\n👥 [2/4] Seeding contacts…");

  const customerPayload = UAT_CUSTOMERS.map((c) => ({
    contact_type: "Customer" as const,
    company_name: c.company_name,
    tax_id: c.tax_id,
    phone: c.phone,
    address: c.address,
    customer_type: c.customer_type,
    default_price_tier: c.default_price_tier,
    credit_days: c.credit_days,
    branch_code: "00000",
    is_active: true,
    ocr_pattern_config: {},
  }));

  const vendorPayload = UAT_VENDORS.map((v) => ({
    contact_type: "Vendor" as const,
    company_name: v.company_name,
    tax_id: v.tax_id,
    phone: v.phone,
    address: v.address,
    customer_type: v.customer_type,
    default_price_tier: v.default_price_tier,
    credit_days: v.credit_days,
    branch_code: "00000",
    is_active: true,
    ocr_pattern_config: {},
  }));

  const { data: customers, error: customerError } = await supabase
    .from("contacts")
    .insert(customerPayload)
    .select("id, company_name");
  assertOk(customerError, "Insert UAT customers");

  const { data: vendors, error: vendorError } = await supabase
    .from("contacts")
    .insert(vendorPayload)
    .select("id, company_name");
  assertOk(vendorError, "Insert UAT vendors");

  for (const row of customers ?? []) {
    console.log(`   ✓ Customer: ${row.company_name}`);
  }
  for (const row of vendors ?? []) {
    console.log(`   ✓ Vendor:   ${row.company_name}`);
  }

  return {
    customers: customers?.length ?? 0,
    vendors: vendors?.length ?? 0,
  };
}

async function seedExpenseCategories(
  supabase: SupabaseClient,
): Promise<{ created: number; reused: number }> {
  console.log("\n📂 [3/4] Seeding expense categories…");

  let created = 0;
  let reused = 0;

  for (const cat of UAT_EXPENSE_CATEGORIES) {
    const { data: existing, error: selectError } = await supabase
      .from("mst_expense_categories")
      .select("id, category_name, description")
      .eq("category_name", cat.category_name)
      .maybeSingle();
    assertOk(selectError, `Select category ${cat.category_name}`);

    if (existing) {
      // Reuse system / prior row — do NOT stamp [UAT] onto shared seed categories
      // (cleanup must not delete production master categories like ค่าขนส่ง)
      console.log(`   ↪ reuse: ${cat.category_name}`);
      reused += 1;
      continue;
    }

    const { error: insertError } = await supabase
      .from("mst_expense_categories")
      .insert({
        category_name: cat.category_name,
        description: cat.description,
        is_active: true,
      });
    assertOk(insertError, `Insert category ${cat.category_name}`);
    console.log(`   ✓ created: ${cat.category_name}`);
    created += 1;
  }

  return { created, reused };
}

async function seedProductsAndBroughtForward(
  supabase: SupabaseClient,
): Promise<{ products: number; ledgerRows: number }> {
  console.log("\n📦 [4/4] Seeding products + brought-forward stock…");

  const productPayload = UAT_PRODUCTS.map((p) => ({
    sku: p.sku,
    name: p.name,
    short_name: p.short_name,
    color: p.color,
    size: p.size,
    cost_price: p.cost_price,
    retail_price: p.retail_price,
    wholesale_price: p.wholesale_price,
    base_uom: "PCS",
    tax_type: "VAT",
    is_active: true,
    description: `${UAT_PREFIX} Dummy SKU for UAT brought-forward`,
  }));

  const { data: products, error: productError } = await supabase
    .from("products")
    .insert(productPayload)
    .select("id, sku, name");
  assertOk(productError, "Insert UAT products");

  if (!products || products.length === 0) {
    throw new Error("Insert UAT products returned empty set");
  }

  for (const p of products) {
    console.log(`   ✓ product: ${p.sku} — ${p.name}`);
  }

  const ledgerPayload = products.map((p) => ({
    product_id: p.id,
    trans_type: "IN",
    qty: BROUGHT_FORWARD_QTY,
    notes: `${UAT_DOC_REF} | Brought Forward | SKU ${p.sku} | qty=${BROUGHT_FORWARD_QTY}`,
    doc_header_id: null,
  }));

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("inventory_ledger")
    .insert(ledgerPayload)
    .select("id, product_id, qty");
  assertOk(ledgerError, "Insert UAT inventory_ledger (Brought Forward)");

  console.log(
    `   ✓ ledger IN × ${ledgerRows?.length ?? 0} (ref=${UAT_DOC_REF}, qty=${BROUGHT_FORWARD_QTY} each)`,
  );

  return {
    products: products.length,
    ledgerRows: ledgerRows?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("══════════════════════════════════════════════════");
  console.log("  Supthavee ERP — UAT Seed Script (Phase 12)");
  console.log("══════════════════════════════════════════════════");

  loadEnvFiles();
  const supabase = createAdminClient();
  console.log(`\n🔗 Target: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

  await cleanupUatData(supabase);
  const contacts = await seedContacts(supabase);
  const categories = await seedExpenseCategories(supabase);
  const stock = await seedProductsAndBroughtForward(supabase);

  console.log("\n══════════════════════════════════════════════════");
  console.log("  ✅ UAT seed completed");
  console.log("──────────────────────────────────────────────────");
  console.log(`  Customers : ${contacts.customers}`);
  console.log(`  Vendors   : ${contacts.vendors}`);
  console.log(
    `  Categories: ${categories.created} created / ${categories.reused} reused`,
  );
  console.log(`  Products  : ${stock.products}`);
  console.log(
    `  Ledger IN : ${stock.ledgerRows} rows @ qty ${BROUGHT_FORWARD_QTY} (notes=${UAT_DOC_REF})`,
  );
  console.log("══════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n❌ UAT seed failed");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
