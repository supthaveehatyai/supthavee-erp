-- =============================================================================
-- Supthavee ERP — Full Schema Initialization
-- Source: System Blueprint v3.6 · Section 5 (Database Schema)
-- Execution order respects Foreign Key dependencies:
--   1. Contacts & Master Data
--   2. Product Models & Products
--   3. Vendor Mapping
--   4. Document Headers & Details
--   5. Payment
--   6. Inventory & Services
--   7. Audit Logs
--   + RLS (vendor_product_mapping) + performance indexes
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ###########################################################################
-- 1. Contacts & Master Data
-- ###########################################################################

-- 1.1 Contacts & Entities
CREATE TABLE public.contacts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    contact_type VARCHAR(20) NOT NULL CHECK (contact_type IN ('Customer', 'Vendor')),
    customer_type VARCHAR(50) DEFAULT 'บุคคลธรรมดา',
    company_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(20),
    branch_code VARCHAR(50) DEFAULT 'สำนักงานใหญ่',
    address TEXT,
    phone VARCHAR(50),
    default_price_tier VARCHAR(20) DEFAULT 'Retail',
    credit_days INTEGER DEFAULT 0,
    ocr_pattern_config JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN public.contacts.ocr_pattern_config IS
  'AI Pattern Memorization — prompt / table layout for Smart Goods Receipt OCR';

CREATE TABLE public.contact_persons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    department_or_role VARCHAR(100),
    is_primary BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 1.2 Master Data
CREATE TABLE public.mst_brands (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    brand_code VARCHAR(10) NOT NULL UNIQUE,
    brand_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE public.mst_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category_code VARCHAR(10) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE public.mst_genders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    gender_code VARCHAR(5) NOT NULL UNIQUE,
    gender_name VARCHAR(50) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.mst_colors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    color_code VARCHAR(10) NOT NULL UNIQUE,
    color_name VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE public.mst_sizes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    brand_id UUID REFERENCES public.mst_brands(id) ON DELETE CASCADE,
    size_label VARCHAR(20) NOT NULL,
    size_code VARCHAR(10) NOT NULL,
    sort_order INTEGER DEFAULT 99,
    is_active BOOLEAN DEFAULT TRUE
);

-- ###########################################################################
-- 2. Product Models & Products
-- ###########################################################################

CREATE TABLE public.product_models (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    model_code VARCHAR(6) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(100),
    vendor_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    brand_id UUID REFERENCES public.mst_brands(id) ON DELETE SET NULL,
    category_id UUID REFERENCES public.mst_categories(id) ON DELETE SET NULL,
    gender VARCHAR(50) DEFAULT 'Unisex (U)',
    tax_type VARCHAR(20) DEFAULT 'INC_VAT' CHECK (tax_type IN ('INC_VAT', 'EXC_VAT', 'NON_VAT')),
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
    size_pricing_config JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    model_id UUID REFERENCES public.product_models(id) ON DELETE CASCADE,
    sku VARCHAR(100) UNIQUE NOT NULL,
    barcode VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(100),
    color VARCHAR(50),
    size VARCHAR(50),
    gender VARCHAR(50) DEFAULT 'ทั่วไป',
    description TEXT,
    category VARCHAR(100),
    tax_type VARCHAR(20) DEFAULT 'INC_VAT',
    base_uom VARCHAR(50) DEFAULT 'ตัว',
    cost_price DECIMAL(10, 2) DEFAULT 0.00,
    retail_price DECIMAL(10, 2) DEFAULT 0.00,
    wholesale_price DECIMAL(10, 2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ###########################################################################
-- 3. Vendor Mapping
-- ###########################################################################

CREATE TABLE public.vendor_product_mapping (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vendor_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
    vendor_sku VARCHAR(100) NOT NULL,
    vendor_product_name VARCHAR(255),
    vendor_uom VARCHAR(50),
    internal_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    conversion_factor DECIMAL(10, 4) DEFAULT 1.0000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (vendor_id, vendor_sku)
);

-- ###########################################################################
-- 4. Document Headers & Details
-- ###########################################################################

CREATE TABLE public.doc_headers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    doc_no VARCHAR(50) UNIQUE NOT NULL,
    doc_type VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL,
    due_date DATE,
    contact_id UUID REFERENCES public.contacts(id) NOT NULL,
    contact_person_id UUID REFERENCES public.contact_persons(id),
    ref_doc_id UUID REFERENCES public.doc_headers(id),
    sub_total DECIMAL(12, 2) DEFAULT 0.00,
    discount_amount DECIMAL(12, 2) DEFAULT 0.00,
    tax_rate DECIMAL(5, 2) DEFAULT 7.00,
    tax_amount DECIMAL(12, 2) DEFAULT 0.00,
    wht_rate DECIMAL(5, 2) DEFAULT 0.00,
    wht_amount DECIMAL(12, 2) DEFAULT 0.00,
    grand_total DECIMAL(12, 2) DEFAULT 0.00,
    deposit_deducted DECIMAL(12, 2) DEFAULT 0.00,
    payment_status VARCHAR(50) DEFAULT 'Pending',
    attached_file_url TEXT,
    original_file_name TEXT
);

CREATE TABLE public.doc_details (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    doc_header_id UUID REFERENCES public.doc_headers(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    description VARCHAR(255),
    qty INTEGER NOT NULL DEFAULT 1,
    uom_used VARCHAR(50),
    unit_price DECIMAL(12, 2) NOT NULL,
    unit_cost_price DECIMAL(12, 2) DEFAULT 0.00,
    discount_text VARCHAR(50),
    discount_amount DECIMAL(12, 2) DEFAULT 0.00,
    line_total DECIMAL(12, 2) NOT NULL
);

-- ###########################################################################
-- 5. Payment
-- ###########################################################################

CREATE TABLE public.payment_slips (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    payment_type VARCHAR(20) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'Transfer',
    account_source VARCHAR(50) DEFAULT 'Company_Bank',
    payment_date TIMESTAMP WITH TIME ZONE NOT NULL,
    total_amount DECIMAL(12, 2) NOT NULL,
    slip_image_url TEXT,
    reference_no VARCHAR(100),
    notes TEXT,
    recorded_by VARCHAR(255)
);

CREATE TABLE public.payment_allocations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    payment_slip_id UUID REFERENCES public.payment_slips(id) ON DELETE CASCADE,
    doc_header_id UUID REFERENCES public.doc_headers(id) ON DELETE CASCADE,
    allocated_amount DECIMAL(12, 2) NOT NULL
);

-- ###########################################################################
-- 6. Inventory & Services
-- ###########################################################################

CREATE TABLE public.inventory_ledger (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    product_id UUID REFERENCES public.products(id) NOT NULL,
    doc_header_id UUID REFERENCES public.doc_headers(id),
    trans_type VARCHAR(20) NOT NULL,
    qty INTEGER NOT NULL,
    notes VARCHAR(255)
);

CREATE TABLE public.service_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    doc_header_id UUID REFERENCES public.doc_headers(id) ON DELETE CASCADE,
    step_status VARCHAR(100) NOT NULL,
    updated_by VARCHAR(255),
    notes TEXT
);

-- ###########################################################################
-- 7. Audit Logs
-- ###########################################################################

CREATE TABLE public.audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_name VARCHAR(100) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    module VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    ip_address VARCHAR(50)
);

-- Ensure base roles can access tables (RLS still controls row-level reads)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- ###########################################################################
-- Row Level Security — Master Data & Products (SELECT for frontend comboboxes)
-- ###########################################################################

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.contacts
  FOR SELECT
  USING (true);

ALTER TABLE public.contact_persons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.contact_persons
  FOR SELECT
  USING (true);

ALTER TABLE public.mst_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.mst_brands
  FOR SELECT
  USING (true);

ALTER TABLE public.mst_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.mst_categories
  FOR SELECT
  USING (true);

ALTER TABLE public.mst_colors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.mst_colors
  FOR SELECT
  USING (true);

ALTER TABLE public.mst_sizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.mst_sizes
  FOR SELECT
  USING (true);

ALTER TABLE public.product_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.product_models
  FOR SELECT
  USING (true);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable public read access"
  ON public.products
  FOR SELECT
  USING (true);

-- ###########################################################################
-- Row Level Security — vendor_product_mapping (Blueprint)
-- ###########################################################################

ALTER TABLE public.vendor_product_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users"
  ON public.vendor_product_mapping
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Enable insert for authenticated users"
  ON public.vendor_product_mapping
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Enable update and delete for authenticated users"
  ON public.vendor_product_mapping
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ###########################################################################
-- Indexes for Performance (Blueprint)
-- ###########################################################################

CREATE INDEX idx_products_sku ON public.products (sku);
CREATE INDEX idx_products_barcode ON public.products (barcode);
CREATE INDEX idx_product_models_code ON public.product_models (model_code);
CREATE INDEX idx_doc_headers_doc_no ON public.doc_headers (doc_no);
CREATE INDEX idx_doc_headers_contact ON public.doc_headers (contact_id);
