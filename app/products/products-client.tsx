"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  ProductModelPreviewSheet,
  buildPreviewModelHref,
} from "@/components/products/ProductModelPreviewSheet";
import {
  getBrands,
  getGenders,
  getGlobalSizes,
  getMasterDataForMatrix,
  getSizesByBrand,
  getUoms,
  getVendorMappingsByProductIds,
  getVendors,
  type MasterSize,
  type MasterUom,
} from "@/lib/actions/master";
import SmartColorCombobox, {
  type SmartColor,
} from "@/components/shared/SmartColorCombobox";
import SizeFormDialog from "@/components/master/SizeFormDialog";
import BrandCombobox, { type Brand } from "./brand-combobox";
import CategoryCombobox, { type Category } from "./category-combobox";
import { type Vendor } from "./vendor-combobox";
import ModelLoadCombobox from "./model-load-combobox";
import { ProductMatrixRawMaterialToggle, ProductMatrixServiceToggle, ProductMatrixVendorField } from "./ProductMatrixForm";
import { ProductModelImageUpload } from "@/components/products/ProductModelImageUpload";
import { BOMSetupPanel } from "@/components/products/BOMSetupPanel";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  findProductModelByCode,
  generateSkusFromModel,
  getProductModelById,
  insertDraftProductModel,
  listLoadableProductModels,
  overwriteDraftProductModel,
  updateProductModel,
} from "./actions/product-matrix";
import type {
  ExistingProductModel,
  LoadableProductModel,
  SaveDraftModelInput,
} from "@/types/product-matrix";
import {
  buildProductSku,
  formatGenderOption,
  type Gender,
  isValidModelCode,
  isValidSizeCodeForSku,
  MODEL_CODE_LENGTH,
  normalizeSkuPart,
  SERVICE_SKU_BRAND_CODE,
} from "./product-sku";
import {
  parseProductModelIdentity,
  vendorIdSchema,
  VENDOR_ID_REQUIRED_MESSAGE,
  zodFirstError,
} from "./zod-schemas";

type TaxType = "INC_VAT" | "EXC_VAT" | "NON_VAT";

const TAX_TYPE_OPTIONS: { value: TaxType; label: string }[] = [
  { value: "INC_VAT", label: "INC_VAT (ราคารวมภาษี)" },
  { value: "EXC_VAT", label: "EXC_VAT (ราคาไม่รวมภาษี)" },
  { value: "NON_VAT", label: "NON_VAT (ไม่มีภาษี)" },
];

type Product = {
  id: string;
  created_at: string;
  sku: string;
  name: string;
  short_name: string | null;
  description: string | null;
  category: string | null;
  color: string | null;
  size: string | null;
  gender: string | null;
  tax_type: TaxType;
  base_uom: string;
  cost_price: number;
  retail_price: number;
  wholesale_price: number;
  is_active: boolean;
  model_id: string | null;
};

type ProductGroup = {
  key: string;
  title: string;
  shortName: string;
  category: string | null;
  gender: string | null;
  taxType: TaxType;
  modelId: string | null;
  products: Product[];
  activeCount: number;
  colors: string[];
  sizes: string[];
  colorGroups: ColorSubGroup[];
};

type ColorSubGroup = {
  key: string;
  color: string;
  products: Product[];
  activeCount: number;
  sizes: string[];
};

type VendorDetail = {
  id: string;
  company_name: string;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  branch_code: string | null;
  credit_days: number | null;
  default_price_tier: string | null;
};

type BrandDetail = {
  id: string;
  brand_code: string;
  brand_name: string;
};

type EntitySheet =
  | { kind: "vendor"; data: VendorDetail }
  | { kind: "brand"; data: BrandDetail };

type BatchEditForm = {
  description: string;
  shortName: string;
  genderId: string;
  taxType: TaxType;
  /** contacts.id where contact_roles contains Vendor → product_models.vendor_id */
  vendorId: string;
  /** รหัสรุ่น (model_code) สำหรับตั้งชื่อไฟล์อัปโหลด */
  modelCode: string;
  /** Public URL จาก product_models.image_url */
  imageUrl: string;
  /** product_models.is_service */
  isService: boolean;
  /** product_models.is_raw_material */
  isRawMaterial: boolean;
  /** product_models.base_uom_id */
  baseUomId: string;
  prices: Record<string, SizePrice>;
};

type Color = SmartColor;

type Size = {
  id: string;
  brand_id: string | null;
  size_label: string;
  size_code: string;
  sort_order: number;
};

type MasterData = {
  brands: Brand[];
  categories: Category[];
  colors: Color[];
  genders: Gender[];
  vendors: Vendor[];
  uoms: MasterUom[];
};

type SizePrice = {
  cost: string;
  retail: string;
  wholesale: string;
};

type DiscountType = "PERCENT" | "THB" | "NET";

/** Per-size pricing config for Matrix Step 3 + draft size_pricing_config. */
type SizePricingRow = {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  retailPrice: string;
  wholesalePrice: string;
  discountType: DiscountType;
  discountValue: string;
  costPrice: string;
};

type MatrixForm = {
  vendorId: string;
  brandId: string;
  categoryId: string;
  genderId: string;
  taxType: TaxType;
  modelCode: string;
  productName: string;
  shortName: string;
  /** Public URL จาก Storage product_assets (Visual Verification) */
  imageUrl: string;
  /** product_models.is_service — งานบริการ ไม่ตัดสต็อก */
  isService: boolean;
  /** product_models.is_raw_material — วัตถุดิบ */
  isRawMaterial: boolean;
  /** product_models.base_uom_id → mst_uom.uom_id */
  baseUomId: string;
  colorIds: string[];
  sizeIds: string[];
};

type PreviewRow = {
  key: string;
  sku: string;
  fullName: string;
  color: Color;
  size: Size;
  prices: SizePrice;
};

const productSelect =
  "id, created_at, sku, name, short_name, description, category, color, size, gender, tax_type, base_uom, cost_price, retail_price, wholesale_price, is_active, model_id";

const emptyMasterData: MasterData = {
  brands: [],
  categories: [],
  colors: [],
  genders: [],
  vendors: [],
  uoms: [],
};

const emptyPrice: SizePrice = { cost: "", retail: "", wholesale: "" };

function createEmptySizePricing(size: Size): SizePricingRow {
  return {
    sizeId: size.id,
    sizeCode: size.size_code,
    sizeLabel: size.size_label,
    retailPrice: "",
    wholesalePrice: "",
    discountType: "PERCENT",
    discountValue: "",
    costPrice: "",
  };
}

/** Raw materials: sell prices locked at 0; cost entered directly (NET mode). */
function applyRawMaterialPricingRow(row: SizePricingRow): SizePricingRow {
  return {
    ...row,
    retailPrice: "0",
    wholesalePrice: "0",
    discountType: "NET",
    discountValue: "",
  };
}

function resolveSizeForPricing(
  sizeId: string,
  sizesCatalog: Size[],
  globalCatalog: Size[],
): Size | undefined {
  return (
    sizesCatalog.find((item) => item.id === sizeId) ??
    globalCatalog.find((item) => item.id === sizeId)
  );
}

/** Real-time cost from retail ± discount. Skipped for NET (manual entry). */
function calculateCostPrice(
  retailPrice: string,
  discountType: DiscountType,
  discountValue: string,
): string {
  if (discountType === "NET") return "";

  const retail = Number(retailPrice);
  if (!Number.isFinite(retail) || retailPrice.trim() === "") return "";

  const discount =
    discountValue.trim() === "" ? 0 : Number(discountValue);
  if (!Number.isFinite(discount)) return "";

  const raw =
    discountType === "PERCENT"
      ? retail - retail * (discount / 100)
      : retail - discount;

  if (!Number.isFinite(raw)) return "";
  return String(Math.round(Math.max(0, raw) * 100) / 100);
}

function withCalculatedCost(row: SizePricingRow): SizePricingRow {
  // Net Price mode: user types cost_price directly — do not overwrite.
  if (row.discountType === "NET") {
    return row;
  }
  return {
    ...row,
    costPrice: calculateCostPrice(
      row.retailPrice,
      row.discountType,
      row.discountValue,
    ),
  };
}

function serializeSizePricingConfig(rows: SizePricingRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      sizeCode: row.sizeCode,
      retailPrice: toPrice(row.retailPrice),
      wholesalePrice: toPrice(row.wholesalePrice),
      discountType: row.discountType,
      discountValue: toPrice(row.discountValue),
      costPrice: toPrice(row.costPrice),
    })),
  );
}

function formatSizePricingSummary(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    try {
      return formatSizePricingSummary(JSON.parse(value));
    } catch {
      return value || "—";
    }
  }
  if (!Array.isArray(value) || value.length === 0) return "ไม่มีราคา";
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      const code = String(row.sizeCode ?? "?");
      const retail = Number(row.retailPrice ?? 0);
      const cost = Number(row.costPrice ?? 0);
      const discountType = String(row.discountType ?? "PERCENT");
      const discountValue = Number(row.discountValue ?? 0);
      const discountLabel =
        discountType === "NET"
          ? "ราคาเน็ต"
          : discountType === "THB"
            ? `ลด ${discountValue}฿`
            : `ลด ${discountValue}%`;
      return `${code}: ปลีก ${retail} → ต้นทุน ${cost} (${discountLabel})`;
    })
    .join("\n");
}

function hydrateSizePricingFromConfig(
  config: unknown,
  brandSizes: Size[],
): { sizeIds: string[]; sizePricing: SizePricingRow[] } {
  let rows: unknown[] = [];
  if (typeof config === "string") {
    try {
      const parsed = JSON.parse(config);
      rows = Array.isArray(parsed) ? parsed : [];
    } catch {
      rows = [];
    }
  } else if (Array.isArray(config)) {
    rows = config;
  }

  const sizeIds: string[] = [];
  const sizePricing: SizePricingRow[] = [];

  for (const item of rows) {
    const raw = item as Record<string, unknown>;
    const sizeCode = String(raw.sizeCode ?? "").toUpperCase();
    if (!sizeCode) continue;
    const size =
      brandSizes.find(
        (entry) => entry.size_code.toUpperCase() === sizeCode,
      ) ??
      brandSizes.find(
        (entry) =>
          entry.size_label.toUpperCase() === sizeCode ||
          entry.size_label === String(raw.sizeLabel ?? ""),
      );
    if (!size) continue;

    const rawDiscountType = String(raw.discountType ?? "PERCENT").toUpperCase();
    const discountType: DiscountType =
      rawDiscountType === "THB"
        ? "THB"
        : rawDiscountType === "NET"
          ? "NET"
          : "PERCENT";

    const row =
      discountType === "NET"
        ? {
            sizeId: size.id,
            sizeCode: size.size_code,
            sizeLabel: size.size_label,
            retailPrice: priceToInput(Number(raw.retailPrice ?? 0)),
            wholesalePrice: priceToInput(Number(raw.wholesalePrice ?? 0)),
            discountType: "NET" as const,
            discountValue: "",
            // Preserve the manually entered net cost from the saved config.
            costPrice: priceToInput(Number(raw.costPrice ?? 0)),
          }
        : withCalculatedCost({
            sizeId: size.id,
            sizeCode: size.size_code,
            sizeLabel: size.size_label,
            retailPrice: priceToInput(Number(raw.retailPrice ?? 0)),
            wholesalePrice: priceToInput(Number(raw.wholesalePrice ?? 0)),
            discountType,
            discountValue: priceToInput(Number(raw.discountValue ?? 0)),
            costPrice: "",
          });

    sizeIds.push(size.id);
    sizePricing.push(row);
  }

  return { sizeIds, sizePricing };
}

const SIZE_SORT_ORDER: Record<string, number> = {
  KS: 2,
  JS: 2,
  KM: 3,
  JM: 3,
  KL: 4,
  JL: 4,
  KXL: 5,
  JXL: 5,
  "3S": 7,
  "2S": 8,
  XS: 8,
  S: 9,
  M: 10,
  L: 11,
  XL: 12,
  "2XL": 13,
  "2L": 13,
  "3XL": 14,
  "3L": 14,
  "4XL": 15,
  "4L": 15,
  "5XL": 16,
  "5L": 16,
  "6XL": 17,
  "6L": 17,
  F: 22,
};

/** Service / Custom sizes in `mst_sizes` (A3, A4, A5, LOGO, …) */
const SERVICE_CUSTOM_SIZE_SORT_MIN = 900;

const SERVICE_CUSTOM_SIZE_GROUP_TITLE =
  "ขนาดงานบริการและงานสั่งทำ (Service/Custom Sizes)";

function getSizeSortWeight(sizeLabel: string | null | undefined): number {
  const key = (sizeLabel ?? "").trim().toUpperCase();
  return SIZE_SORT_ORDER[key] ?? 99;
}

function compareSizeLabels(left: string, right: string): number {
  const weightDiff = getSizeSortWeight(left) - getSizeSortWeight(right);
  if (weightDiff !== 0) return weightDiff;
  return left.localeCompare(right, "th", { numeric: true, sensitivity: "base" });
}

function isKidsApparelSizeLabel(label: string): boolean {
  return /^[KJ]/i.test(label.trim());
}

function isServiceCustomSize(size: { sort_order: number }): boolean {
  return Number(size.sort_order) >= SERVICE_CUSTOM_SIZE_SORT_MIN;
}

/**
 * Group Global Size catalog for Product Matrix Step 2.
 * Apparel → Kids / Adult; Service/Custom (sort_order ≥ 900) → separate list.
 */
function partitionGlobalSizes(catalog: Size[]): {
  kids: Size[];
  adults: Size[];
  serviceCustom: Size[];
} {
  const sorted = [...catalog]
    .map((size) => ({
      ...size,
      sort_order: Number(size.sort_order ?? 0),
    }))
    .sort((left, right) => left.sort_order - right.sort_order);

  const kids: Size[] = [];
  const adults: Size[] = [];
  const serviceCustom: Size[] = [];

  for (const size of sorted) {
    if (isServiceCustomSize(size)) {
      serviceCustom.push(size);
      continue;
    }
    if (isKidsApparelSizeLabel(size.size_label)) {
      kids.push(size);
      continue;
    }
    adults.push(size);
  }

  return { kids, adults, serviceCustom };
}

function createEmptyForm(vendorId = ""): MatrixForm {
  return {
    vendorId,
    brandId: "",
    categoryId: "",
    genderId: "",
    taxType: "INC_VAT",
    modelCode: "",
    productName: "",
    shortName: "",
    imageUrl: "",
    isService: false,
    isRawMaterial: false,
    baseUomId: "",
    colorIds: [],
    sizeIds: [],
  };
}

function findPcsUomId(uoms: MasterUom[]): string {
  return (
    uoms.find((item) => item.uom_code.trim().toUpperCase() === "PCS")?.uom_id ??
    ""
  );
}

function findNoneGenderId(genders: Gender[]): string {
  return (
    genders.find((item) => item.gender_code.trim().toUpperCase() === "N")?.id ??
    ""
  );
}

const SYSTEM_NA_SIZE_CODE = "00";

function findSystemNaSize(catalog: Size[]): Size | undefined {
  return catalog.find(
    (size) =>
      size.size_code.trim().toUpperCase() === SYSTEM_NA_SIZE_CODE ||
      size.size_label.trim().toUpperCase() === "N/A",
  );
}

function matrixUsesNaSizeOnly(form: Pick<MatrixForm, "isService" | "isRawMaterial">): boolean {
  return form.isService || form.isRawMaterial;
}

/**
 * Vendors / Brands / Categories / Colors / Genders ALL come from the
 * `getMasterDataForMatrix` Server Action (Service Role Key — Phase 3
 * "Strict Server-Side Fetching") to bypass RLS "Permission Denied" on
 * `contacts`, `mst_brands`, `mst_categories`, `mst_colors`, and `mst_genders`.
 * Zero client-side `supabase.from(...)` calls remain for Master Data.
 */
async function fetchMasterData(): Promise<{
  data: MasterData;
  warnings: string[];
}> {
  const masterResult = await getMasterDataForMatrix();

  const sourceLabels: Record<string, string> = {
    brands: "แบรนด์",
    categories: "หมวดหมู่",
    colors: "สี",
    genders: "เพศ",
    vendors: "ผู้จำหน่าย",
    uoms: "หน่วยนับ",
  };

  const warnings = Object.entries(masterResult.errors ?? {}).map(
    ([source, message]) =>
      `${sourceLabels[source] ?? source}: ${message}`,
  );

  return {
    data: {
      brands: masterResult.brands,
      categories: masterResult.categories,
      colors: masterResult.colors,
      genders: masterResult.genders,
      vendors: masterResult.vendors,
      uoms: masterResult.uoms,
    },
    warnings,
  };
}

/**
 * `mst_sizes` — same Phase 3 "Strict Server-Side Fetching" rule as
 * `fetchMasterData` above: zero client-side `supabase.from(...)` calls,
 * everything routes through `lib/actions/master.ts` (Service Role Key).
 */
async function fetchSizesByBrand(brandId: string): Promise<Size[]> {
  const result = await getSizesByBrand(brandId);
  if (result.error) throw new Error(result.error);
  return result.data as Size[];
}

/** Global Size catalog (`brand_id IS NULL`) — SELECT only, never INSERT. */
async function fetchGlobalSizes(): Promise<Size[]> {
  const result = await getGlobalSizes();
  if (result.error) throw new Error(result.error);
  return result.data as Size[];
}

function toPrice(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function priceToInput(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function getProductGroupKey(product: Product): string {
  const description = product.description?.trim();
  if (description) return `desc:${description}`;
  const shortName = product.short_name?.trim();
  if (shortName) return `short:${shortName}`;
  return `name:${product.name}`;
}

function getProductGroupTitle(product: Product): string {
  return (
    product.description?.trim() ||
    product.short_name?.trim() ||
    product.name
  );
}

function buildColorSubGroups(groupProducts: Product[]): ColorSubGroup[] {
  const map = new Map<string, Product[]>();
  for (const product of groupProducts) {
    const color = product.color?.trim() || "ไม่ระบุสี";
    const bucket = map.get(color);
    if (bucket) bucket.push(product);
    else map.set(color, [product]);
  }

  return Array.from(map.entries())
    .map(([color, products]) => {
      const sizes = [
        ...new Set(
          products
            .map((item) => item.size)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(compareSizeLabels);

      const sortedProducts = [...products].sort((left, right) =>
        compareSizeLabels(left.size || "", right.size || ""),
      );

      return {
        key: color,
        color,
        products: sortedProducts,
        activeCount: products.filter((item) => item.is_active).length,
        sizes,
      };
    })
    .sort((left, right) =>
      left.color.localeCompare(right.color, "th", { sensitivity: "base" }),
    );
}

function buildGroupedProducts(list: Product[]): ProductGroup[] {
  const map = new Map<string, Product[]>();
  for (const product of list) {
    const key = getProductGroupKey(product);
    const bucket = map.get(key);
    if (bucket) bucket.push(product);
    else map.set(key, [product]);
  }

  return Array.from(map.entries())
    .map(([key, groupProducts]) => {
      const first = groupProducts[0];
      const colorGroups = buildColorSubGroups(groupProducts);
      const colors = colorGroups.map((group) => group.color);
      const sizes = [
        ...new Set(colorGroups.flatMap((group) => group.sizes)),
      ];

      return {
        key,
        title: getProductGroupTitle(first),
        shortName: first.short_name?.trim() || "",
        category: first.category,
        gender: first.gender,
        taxType: first.tax_type,
        modelId:
          groupProducts.find((item) => item.model_id)?.model_id ?? null,
        products: groupProducts,
        activeCount: groupProducts.filter((item) => item.is_active).length,
        colors,
        sizes,
        colorGroups,
      };
    })
    .sort((left, right) =>
      left.title.localeCompare(right.title, "th", { sensitivity: "base" }),
    );
}

function resolveBrandFromSku(
  sku: string,
  brands: BrandDetail[],
): BrandDetail | null {
  const upper = sku.trim().toUpperCase();
  if (!upper || brands.length === 0) return null;
  return (
    [...brands]
      .sort((left, right) => right.brand_code.length - left.brand_code.length)
      .find((brand) =>
        upper.startsWith(brand.brand_code.trim().toUpperCase()),
      ) ?? null
  );
}

function Icon({
  name,
  className = "size-4",
}: {
  name:
    | "plus"
    | "search"
    | "close"
    | "box"
    | "sparkles"
    | "layers"
    | "palette"
    | "check"
    | "chevron"
    | "edit"
    | "ban";
  className?: string;
}) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    box: (
      <>
        <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
        <path d="M3 8l9 5 9-5M12 13v8" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2z" />
        <path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
        <path d="m5 13 .6 1.4L7 15l-1.4.6L5 17l-.6-1.4L3 15l1.4-.6z" />
      </>
    ),
    layers: (
      <>
        <path d="m12 2 9 5-9 5-9-5z" />
        <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
      </>
    ),
    palette: (
      <>
        <path d="M12 21a9 9 0 1 1 9-9c0 2.5-1.5 3.5-3 3.5h-2a2 2 0 0 0-1.5 3.3c.4.5.5 1.2-.2 1.6-.7.4-1.5.6-2.3.6z" />
        <circle cx="7.5" cy="11" r="1" />
        <circle cx="10.5" cy="7.5" r="1" />
        <circle cx="15" cy="7.5" r="1" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </>
    ),
    ban: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m5.5 5.5 13 13" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

const fieldClass =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";
const baht = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function StepHeading({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-sm shadow-blue-600/30">
        {number}
      </span>
      <div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function PriceInput({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        readOnly={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0.00"
        className={`${fieldClass} pr-8 text-right tabular-nums ${
          disabled ? "cursor-not-allowed bg-slate-50 text-slate-600" : ""
        }`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
        ฿
      </span>
    </div>
  );
}

export default function ProductsClient() {
  /**
   * `?vendorId=` — set when arriving from the Goods Receipt "Full Matrix"
   * on-the-fly link-out (see `components/procurement/FullMatrixDialog.tsx`).
   * Pre-fills the Vendor field the next time "สร้าง Product Matrix" is
   * opened, so the operator doesn't have to re-select the vendor manually.
   */
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const vendorIdFromQuery = searchParams.get("vendorId")?.trim() || "";

  function openModelPreview(modelId: string | null | undefined) {
    const id = modelId?.trim() || "";
    if (!id) {
      toast.message("ไม่พบรุ่นสินค้าสำหรับรายการนี้");
      return;
    }
    router.push(buildPreviewModelHref(pathname, searchParams, id), {
      scroll: false,
    });
  }

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<MatrixForm>(createEmptyForm);
  const [masterData, setMasterData] = useState<MasterData>(emptyMasterData);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [isMasterLoading, setIsMasterLoading] = useState(false);
  const [isSizeLoading, setIsSizeLoading] = useState(false);
  /** Global Size catalog for the standard-size grid (SELECT only). */
  const [globalSizeCatalog, setGlobalSizeCatalog] = useState<Size[]>([]);
  const [isGlobalSizeLoading, setIsGlobalSizeLoading] = useState(false);
  /** Inline panel: standard size selection grid (no create modal). */
  const [isStandardSizePanelOpen, setIsStandardSizePanelOpen] = useState(false);
  const [quickSizeLabels, setQuickSizeLabels] = useState<string[]>([]);
  const [isQuickSizeSaving, setIsQuickSizeSaving] = useState(false);
  /** Master Data create/edit dialog for `mst_sizes` (Fixed-2 size_code). */
  const [isSizeMasterDialogOpen, setIsSizeMasterDialogOpen] = useState(false);
  const [editingMasterSize, setEditingMasterSize] = useState<Size | null>(null);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedColorGroups, setExpandedColorGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [vendorByProductId, setVendorByProductId] = useState<
    Record<string, VendorDetail>
  >({});
  const [listBrands, setListBrands] = useState<BrandDetail[]>([]);
  const [entitySheet, setEntitySheet] = useState<EntitySheet | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ProductGroup | null>(
    null,
  );
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState("");

  const [editTarget, setEditTarget] = useState<ProductGroup | null>(null);
  const [editForm, setEditForm] = useState<BatchEditForm | null>(null);
  const [batchEditTab, setBatchEditTab] = useState<"general" | "bom">("general");
  const [editError, setEditError] = useState("");
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [isEditConfirmOpen, setIsEditConfirmOpen] = useState(false);
  const [draftModelId, setDraftModelId] = useState<string | null>(null);
  const [loadedModelStatus, setLoadedModelStatus] = useState<
    "DRAFT" | "ACTIVE" | null
  >(null);
  const [loadableModels, setLoadableModels] = useState<LoadableProductModel[]>(
    [],
  );
  const [isLoadableModelsLoading, setIsLoadableModelsLoading] = useState(false);
  const [pendingSizePricingConfig, setPendingSizePricingConfig] = useState<
    unknown | null
  >(null);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [isOverwriteModalOpen, setIsOverwriteModalOpen] = useState(false);
  const [existingDraftModel, setExistingDraftModel] =
    useState<ExistingProductModel | null>(null);
  const [pendingDraftPayload, setPendingDraftPayload] =
    useState<SaveDraftModelInput | null>(null);
  const [sizePricing, setSizePricing] = useState<SizePricingRow[]>([]);
  const [shortNameTouched, setShortNameTouched] = useState(false);
  const [productNameTouched, setProductNameTouched] = useState(false);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    const { data, error } = await supabase
      .from("products")
      .select(productSelect)
      .order("created_at", { ascending: false });

    if (error) {
      setProducts([]);
      setVendorByProductId({});
      setListBrands([]);
      setLoadError(error.message);
      setIsLoading(false);
      return;
    }

    const nextProducts = (data ?? []) as Product[];
    setProducts(nextProducts);

    // Brands (mst_brands) + vendor mapping (vendor_product_mapping → contacts)
    // go through Server Actions — Service Role Key bypasses RLS entirely.
    const productIds = nextProducts.map((item) => item.id);
    const [brandsResult, mappingsResult] = await Promise.all([
      getBrands(),
      getVendorMappingsByProductIds(productIds),
    ]);

    if (!brandsResult.error) {
      setListBrands(brandsResult.data);
    }

    if (!mappingsResult.error) {
      const nextVendors: Record<string, VendorDetail> = {};
      for (const row of mappingsResult.data) {
        if (row.internal_product_id && row.vendor.id) {
          nextVendors[row.internal_product_id] = row.vendor;
        }
      }
      setVendorByProductId(nextVendors);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!entitySheet) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setEntitySheet(null);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [entitySheet]);

  // Keep Escape-handler flags in a ref so useEffect deps stay a fixed length.
  const matrixEscapeStateRef = useRef({
    isStandardSizePanelOpen,
    isOverwriteModalOpen,
    isSaving,
    isDraftSaving,
  });
  matrixEscapeStateRef.current = {
    isStandardSizePanelOpen,
    isOverwriteModalOpen,
    isSaving,
    isDraftSaving,
  };

  useEffect(() => {
    if (!isDialogOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      const state = matrixEscapeStateRef.current;
      if (state.isStandardSizePanelOpen) {
        setIsStandardSizePanelOpen(false);
        setQuickSizeLabels([]);
        return;
      }
      if (state.isOverwriteModalOpen) {
        if (!state.isDraftSaving) {
          setIsOverwriteModalOpen(false);
          setExistingDraftModel(null);
          setPendingDraftPayload(null);
        }
        return;
      }
      if (!state.isSaving && !state.isDraftSaving) {
        setIsDialogOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDialogOpen]);

  const prevBrandIdForSizesRef = useRef(form.brandId);

  useEffect(() => {
    const brandChanged = prevBrandIdForSizesRef.current !== form.brandId;
    prevBrandIdForSizesRef.current = form.brandId;

    if (matrixUsesNaSizeOnly(form)) {
      if (pendingSizePricingConfig != null) {
        setPendingSizePricingConfig(null);
      }
      return;
    }

    if (!form.brandId && !form.isService && !form.isRawMaterial) {
      setSizes([]);
      setQuickSizeLabels([]);
      setIsStandardSizePanelOpen(false);
      return;
    }

    let active = true;

    // Hydrate size pricing from a loaded DRAFT/ACTIVE model (Global + brand sizes).
    if (pendingSizePricingConfig != null) {
      setIsSizeLoading(true);
      setQuickSizeLabels([]);
      setIsStandardSizePanelOpen(false);

      void (async () => {
        try {
          const [brandData, globalData] = await Promise.all([
            form.brandId
              ? fetchSizesByBrand(form.brandId)
              : Promise.resolve([] as Size[]),
            fetchGlobalSizes(),
          ]);
          if (!active) return;

          setGlobalSizeCatalog(globalData);

          const byId = new Map<string, Size>();
          for (const size of globalData) byId.set(size.id, size);
          for (const size of brandData) byId.set(size.id, size);
          const catalog = [...byId.values()].sort(
            (left, right) => left.sort_order - right.sort_order,
          );

          const hydrated = hydrateSizePricingFromConfig(
            pendingSizePricingConfig,
            catalog,
          );
          setSizes(
            catalog.filter((size) => hydrated.sizeIds.includes(size.id)),
          );
          setForm((current) => ({
            ...current,
            sizeIds: hydrated.sizeIds,
          }));
          setSizePricing(hydrated.sizePricing);
          setPendingSizePricingConfig(null);
        } catch (error) {
          if (active) {
            setSizes([]);
            setFormError(
              `ไม่สามารถโหลดข้อมูลไซส์ได้: ${
                error instanceof Error ? error.message : "เกิดข้อผิดพลาด"
              }`,
            );
          }
        } finally {
          if (active) setIsSizeLoading(false);
        }
      })();

      return () => {
        active = false;
      };
    }

    // Brand switched (no pending hydrate): clear Matrix size selection.
    if (brandChanged) {
      setSizes([]);
      setQuickSizeLabels([]);
      setIsStandardSizePanelOpen(false);
      setIsSizeLoading(false);
    }
  }, [form.brandId, form.isService, form.isRawMaterial, pendingSizePricingConfig]);

  const selectedBrand = masterData.brands.find(
    (brand) => brand.id === form.brandId,
  );
  const selectedCategory = masterData.categories.find(
    (category) => category.id === form.categoryId,
  );
  const selectedGender = masterData.genders.find(
    (gender) => gender.id === form.genderId,
  );

  const baseProductName = useMemo(() => {
    const typed = form.productName.trim();
    if (typed) return typed;
    if (!selectedCategory || !isValidModelCode(form.modelCode)) return "";
    return `${selectedCategory.category_name} ${form.modelCode.trim()}`;
  }, [form.productName, form.modelCode, selectedCategory]);

  const sizePricingById = useMemo(() => {
    const map = new Map<string, SizePricingRow>();
    for (const row of sizePricing) map.set(row.sizeId, row);
    return map;
  }, [sizePricing]);

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (
      (!selectedBrand && !form.isService && !form.isRawMaterial) ||
      !selectedCategory ||
      !selectedGender ||
      !isValidModelCode(form.modelCode)
    ) {
      return [];
    }

    const selectedColors = masterData.colors.filter((color) =>
      form.colorIds.includes(color.id),
    );
    const selectedSizes = sizes.filter(
      (size) =>
        form.sizeIds.includes(size.id) && isValidSizeCodeForSku(size.size_code),
    );

    return selectedColors.flatMap((color) =>
      selectedSizes.map((size) => {
        const sku = buildProductSku({
          brandCode: selectedBrand?.brand_code || SERVICE_SKU_BRAND_CODE,
          categoryCode: selectedCategory.category_code,
          modelCode: form.modelCode,
          genderCode: selectedGender.gender_code,
          colorCode: color.color_code,
          sizeCode: size.size_code,
        });
        const pricing = sizePricingById.get(size.id);

        return {
          key: `${color.id}-${size.id}`,
          sku,
          fullName: `${baseProductName} สี${color.color_name} ไซส์ ${size.size_label}`,
          color,
          size,
          prices: {
            cost: pricing?.costPrice ?? "",
            retail: pricing?.retailPrice ?? "",
            wholesale: pricing?.wholesalePrice ?? "",
          },
        };
      }),
    );
  }, [
    baseProductName,
    form.colorIds,
    form.modelCode,
    form.isService,
    form.isRawMaterial,
    form.sizeIds,
    masterData.colors,
    selectedBrand,
    selectedCategory,
    selectedGender,
    sizePricingById,
    sizes,
  ]);

  // Auto-fill short_name from category; product_name from category + model_code
  useEffect(() => {
    if (!selectedCategory) return;

    const categoryName = selectedCategory.category_name;
    const modelCode = form.modelCode.trim();

    setForm((current) => {
      const nextShortName =
        !shortNameTouched || !current.shortName.trim()
          ? categoryName
          : current.shortName;

      const shouldAutoProductName =
        !productNameTouched &&
        modelCode.length === MODEL_CODE_LENGTH &&
        isValidModelCode(modelCode);

      const nextProductName = shouldAutoProductName
        ? `${categoryName} ${modelCode}`
        : current.productName;

      if (
        nextShortName === current.shortName &&
        nextProductName === current.productName
      ) {
        return current;
      }

      return {
        ...current,
        shortName: nextShortName,
        productName: nextProductName,
      };
    });
  }, [
    selectedCategory,
    form.modelCode,
    shortNameTouched,
    productNameTouched,
  ]);

  const isStep1Complete = Boolean(
    (form.isService || (form.vendorId && form.brandId)) &&
      form.categoryId &&
      form.genderId &&
      form.baseUomId &&
      isValidModelCode(form.modelCode) &&
      baseProductName,
  );

  const isStep2Complete =
    form.colorIds.length > 0 && form.sizeIds.length > 0;

  const isStep3Complete =
    isStep2Complete &&
    form.sizeIds.every((sizeId) => {
      const pricing = sizePricingById.get(sizeId);
      if (!pricing) return false;
      if (form.isRawMaterial) {
        return (
          pricing.costPrice.trim() !== "" &&
          Number.isFinite(Number(pricing.costPrice))
        );
      }
      return (
        pricing.retailPrice.trim() !== "" &&
        Number.isFinite(Number(pricing.retailPrice)) &&
        pricing.costPrice.trim() !== "" &&
        Number.isFinite(Number(pricing.costPrice))
      );
    });

  const canGenerateSkus =
    isStep1Complete &&
    isStep2Complete &&
    isStep3Complete &&
    previewRows.length > 0 &&
    previewRows.every((row) => Boolean(row.sku));

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return products;
    return products.filter((product) => {
      const vendor = vendorByProductId[product.id];
      const brand = resolveBrandFromSku(product.sku, listBrands);
      return [
        product.sku,
        product.name,
        product.short_name,
        product.description,
        product.category,
        product.color,
        product.size,
        product.gender,
        vendor?.company_name,
        brand?.brand_name,
        brand?.brand_code,
      ].some((value) => value?.toLocaleLowerCase("th").includes(keyword));
    });
  }, [products, search, vendorByProductId, listBrands]);

  const productGroups = useMemo(
    () => buildGroupedProducts(filteredProducts),
    [filteredProducts],
  );

  const editSizeLabels = useMemo(() => {
    if (!editTarget) return [];
    return [
      ...new Set(
        editTarget.products
          .map((product) => product.size)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }, [editTarget]);

  const { kids: kidsSizes, adults: adultSizes, serviceCustom: serviceCustomSizes } =
    useMemo(() => partitionGlobalSizes(globalSizeCatalog), [globalSizeCatalog]);

  const matrixUsesNaSizeOnlyFlag = matrixUsesNaSizeOnly(form);
  const prevMatrixUsesNaSizeOnlyRef = useRef(false);

  const systemNaSize = useMemo(
    () => findSystemNaSize(sizes) ?? findSystemNaSize(globalSizeCatalog),
    [sizes, globalSizeCatalog],
  );

  const applyNaSizeOnlyMatrix = useCallback(async () => {
    setIsStandardSizePanelOpen(false);
    setQuickSizeLabels([]);

    let catalog = globalSizeCatalog;
    if (catalog.length === 0) {
      try {
        catalog = await fetchGlobalSizes();
        setGlobalSizeCatalog(catalog);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "โหลดไซส์ไม่สำเร็จ";
        setFormError(message);
        toast.error(message);
        return;
      }
    }

    const naSize = findSystemNaSize(catalog);
    if (!naSize) {
      const message =
        "ไม่พบไซส์ระบบ 00 (N/A) ใน mst_sizes — กรุณา seed ไซส์ก่อน";
      setFormError(message);
      toast.error(message);
      return;
    }

    setSizes([naSize]);
    setForm((current) => ({ ...current, sizeIds: [naSize.id] }));
    setSizePricing((current) => {
      const existing = current.find((row) => row.sizeId === naSize.id);
      if (existing) return current;
      const base = createEmptySizePricing(naSize);
      const row = form.isRawMaterial ? applyRawMaterialPricingRow(base) : base;
      return [row];
    });
  }, [globalSizeCatalog, form.isRawMaterial]);

  const clearNaSizeMatrixSelection = useCallback(() => {
    setIsStandardSizePanelOpen(false);
    setQuickSizeLabels([]);
    setSizes([]);
    setForm((current) => ({ ...current, sizeIds: [] }));
    setSizePricing([]);
  }, []);

  useEffect(() => {
    if (!isDialogOpen) {
      prevMatrixUsesNaSizeOnlyRef.current = false;
      return;
    }

    if (matrixUsesNaSizeOnlyFlag) {
      const naId = systemNaSize?.id;
      if (form.sizeIds.length !== 1 || form.sizeIds[0] !== naId) {
        void applyNaSizeOnlyMatrix();
      }
      prevMatrixUsesNaSizeOnlyRef.current = true;
      return;
    }

    if (prevMatrixUsesNaSizeOnlyRef.current) {
      clearNaSizeMatrixSelection();
    }
    prevMatrixUsesNaSizeOnlyRef.current = false;
  }, [
    isDialogOpen,
    matrixUsesNaSizeOnlyFlag,
    form.sizeIds,
    form.isRawMaterial,
    systemNaSize?.id,
    applyNaSizeOnlyMatrix,
    clearNaSizeMatrixSelection,
  ]);

  /** Ensure every selected size has a sizePricing row (fixes size 00 auto-fill key drift). */
  useEffect(() => {
    if (!isDialogOpen || form.sizeIds.length === 0) return;

    setSizePricing((current) => {
      const missingIds = form.sizeIds.filter(
        (sizeId) => !current.some((row) => row.sizeId === sizeId),
      );
      if (missingIds.length === 0) return current;

      const additions = missingIds
        .map((sizeId) => {
          const size = resolveSizeForPricing(
            sizeId,
            sizes,
            globalSizeCatalog,
          );
          if (!size) return null;
          const base = createEmptySizePricing(size);
          return form.isRawMaterial
            ? applyRawMaterialPricingRow(base)
            : base;
        })
        .filter((row): row is SizePricingRow => row !== null);

      if (additions.length === 0) return current;
      return [...current, ...additions];
    });
  }, [
    isDialogOpen,
    form.sizeIds,
    form.isRawMaterial,
    sizes,
    globalSizeCatalog,
  ]);

  async function openDialog(presetVendorId?: string) {
    setForm(createEmptyForm(presetVendorId ?? ""));
    setSizes([]);
    setSizePricing([]);
    setShortNameTouched(false);
    setProductNameTouched(false);
    setFormError("");
    setDraftModelId(null);
    setLoadedModelStatus(null);
    setPendingSizePricingConfig(null);
    setIsOverwriteModalOpen(false);
    setExistingDraftModel(null);
    setPendingDraftPayload(null);
    setIsStandardSizePanelOpen(false);
    setQuickSizeLabels([]);
    prevMatrixUsesNaSizeOnlyRef.current = false;
    setIsDialogOpen(true);
    setIsMasterLoading(true);
    setIsLoadableModelsLoading(true);

    try {
      const { data, warnings } = await fetchMasterData();

      const allEmpty =
        data.brands.length === 0 &&
        data.categories.length === 0 &&
        data.colors.length === 0 &&
        data.genders.length === 0 &&
        data.vendors.length === 0 &&
        data.uoms.length === 0;

      if (allEmpty && warnings.length > 0) {
        setMasterData(emptyMasterData);
        setFormError(
          `ไม่สามารถโหลด Master Data ได้: ${warnings.join(" · ")}`,
        );
      } else {
        setMasterData(data);
        if (warnings.length > 0) {
          toast.warning(
            `โหลด Master Data บางส่วนไม่สำเร็จ — dropdown ที่โหลดได้ยังใช้งานได้ (${warnings.join(" · ")})`,
          );
        }

        const defaultGender =
          data.genders.find((item) => item.gender_name === "ทั่วไป") ??
          data.genders[0];
        const pcsUomId = findPcsUomId(data.uoms);
        setForm((current) => ({
          ...current,
          genderId: current.isRawMaterial
            ? findNoneGenderId(data.genders) || current.genderId
            : defaultGender?.id ?? current.genderId,
          baseUomId: current.isRawMaterial
            ? current.baseUomId
            : current.baseUomId || pcsUomId,
        }));
      }
    } catch (error) {
      setMasterData(emptyMasterData);
      setFormError(
        `ไม่สามารถโหลด Master Data ได้: ${
          error instanceof Error ? error.message : "เกิดข้อผิดพลาด"
        }`,
      );
    } finally {
      setIsMasterLoading(false);
    }

    try {
      const result = await listLoadableProductModels();
      if (!result.ok) {
        setLoadableModels([]);
        toast.error(result.error ?? "โหลดรายการโมเดลไม่สำเร็จ");
      } else {
        setLoadableModels(result.models);
      }
    } catch (error) {
      setLoadableModels([]);
      toast.error(
        error instanceof Error ? error.message : "โหลดรายการโมเดลไม่สำเร็จ",
      );
    } finally {
      setIsLoadableModelsLoading(false);
    }
  }

  function closeDialog() {
    if (!isSaving && !isDraftSaving) setIsDialogOpen(false);
  }

  function updateForm<K extends keyof MatrixForm>(
    key: K,
    value: MatrixForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeBrand(brandId: string) {
    setIsStandardSizePanelOpen(false);
    setQuickSizeLabels([]);
    setSizePricing([]);
    setForm((current) => ({
      ...current,
      brandId,
      sizeIds:
        current.isService || current.isRawMaterial ? current.sizeIds : [],
    }));
    setFormError("");
  }

  async function handleLoadModel(
    modelId: string,
    model: LoadableProductModel | null,
  ) {
    if (!modelId || !model) return;

    setFormError("");
    setDraftModelId(model.id);
    setLoadedModelStatus(model.status === "ACTIVE" ? "ACTIVE" : "DRAFT");
    setShortNameTouched(true);
    setProductNameTouched(true);
    const loadsNaMatrix =
      model.is_raw_material === true || model.is_service === true;
    setPendingSizePricingConfig(
      loadsNaMatrix ? null : (model.size_pricing_config ?? []),
    );
    setSizePricing([]);
    setQuickSizeLabels([]);

    const matchedGender =
      masterData.genders.find(
        (item) =>
          item.gender_name === model.gender ||
          item.gender_code === model.gender,
      ) ?? masterData.genders[0];

    let taxType: TaxType = "INC_VAT";
    const taxRaw = String(model.tax_type ?? "INC_VAT").toUpperCase();
    if (taxRaw.includes("EXC")) taxType = "EXC_VAT";
    else if (taxRaw.includes("NON")) taxType = "NON_VAT";

    setForm((current) => ({
      ...current,
      vendorId: model.vendor_id ?? current.vendorId,
      brandId: model.brand_id ?? "",
      categoryId: model.category_id ?? "",
      genderId: matchedGender?.id ?? current.genderId,
      taxType,
      modelCode: model.model_code ?? "",
      productName: model.name ?? "",
      shortName: model.short_name ?? "",
      imageUrl: (model.image_url ?? "").split("?")[0],
      isService: model.is_service === true,
      isRawMaterial: model.is_raw_material === true,
      baseUomId: model.base_uom_id ?? "",
      colorIds: [],
      sizeIds: [],
    }));

    if (model.is_raw_material === true) {
      const noneGenderId = findNoneGenderId(masterData.genders);
      if (noneGenderId) {
        setForm((current) => ({ ...current, genderId: noneGenderId }));
      }
    }

    toast.success(
      `โหลดโมเดล ${model.model_code} (${model.status ?? "DRAFT"}) แล้ว — เพิ่มสี/ไซส์ใหม่แล้วกดสร้าง SKU ได้`,
    );
  }

  function toggleQuickSize(label: string) {
    setQuickSizeLabels((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label],
    );
  }

  /** Open the Global Size selection grid — always refetch (no stale Turbopack cache). */
  async function openStandardSizePanel() {
    if (matrixUsesNaSizeOnly(form)) return;

    const alreadySelectedLabels = sizes
      .filter((size) => form.sizeIds.includes(size.id))
      .map((size) => size.size_label);
    setQuickSizeLabels(alreadySelectedLabels);
    setIsStandardSizePanelOpen(true);

    if (isGlobalSizeLoading) return;

    setIsGlobalSizeLoading(true);
    try {
      setGlobalSizeCatalog(await fetchGlobalSizes());
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "โหลดรายการไซส์มาตรฐานไม่สำเร็จ",
      );
    } finally {
      setIsGlobalSizeLoading(false);
    }
  }

  function openCreateMasterSizeDialog() {
    setEditingMasterSize(null);
    setIsSizeMasterDialogOpen(true);
  }

  function openEditMasterSizeDialog(size: Size) {
    setEditingMasterSize(size);
    setIsSizeMasterDialogOpen(true);
  }

  async function handleMasterSizeSaved(saved: MasterSize) {
    const next: Size = {
      id: saved.id,
      brand_id: saved.brand_id,
      size_label: saved.size_label,
      size_code: saved.size_code,
      sort_order: saved.sort_order,
    };

    setGlobalSizeCatalog((current) => {
      const map = new Map(current.map((row) => [row.id, row]));
      map.set(next.id, next);
      return [...map.values()].sort(
        (left, right) => left.sort_order - right.sort_order,
      );
    });

    setSizes((current) => {
      const map = new Map(current.map((row) => [row.id, row]));
      if (map.has(next.id) || form.sizeIds.includes(next.id)) {
        map.set(next.id, next);
      }
      return [...map.values()].sort(
        (left, right) => left.sort_order - right.sort_order,
      );
    });

    try {
      setGlobalSizeCatalog(await fetchGlobalSizes());
    } catch {
      // Local catalog already patched above.
    }
  }

  /**
   * Confirm grid selection — SELECT existing Global Size rows into Matrix
   * state only. Does NOT call createSizesBulk / INSERT into mst_sizes.
   */
  async function handleConfirmStandardSizes() {
    if (quickSizeLabels.length === 0 || isQuickSizeSaving) return;

    setIsQuickSizeSaving(true);
    setFormError("");

    try {
      let catalog = globalSizeCatalog;
      if (catalog.length === 0) {
        catalog = await fetchGlobalSizes();
        setGlobalSizeCatalog(catalog);
      }

      const byLabel = new Map(
        catalog.map((size) => [size.size_label.trim().toUpperCase(), size]),
      );
      // Fall back to brand-scoped sizes already in memory (legacy rows).
      for (const size of sizes) {
        const key = size.size_label.trim().toUpperCase();
        if (!byLabel.has(key)) byLabel.set(key, size);
      }

      const matched: Size[] = [];
      const missing: string[] = [];
      for (const label of quickSizeLabels) {
        const found = byLabel.get(label.trim().toUpperCase());
        if (found) matched.push(found);
        else missing.push(label);
      }

      if (matched.length === 0) {
        const message =
          missing.length > 0
            ? `ไม่พบไซส์ในระบบ: ${missing.join(", ")}`
            : "ไม่พบไซส์ที่เลือกในระบบ";
        setFormError(message);
        toast.error(message);
        return;
      }

      if (missing.length > 0) {
        toast.error(`ข้ามไซส์ที่ไม่มีในระบบ: ${missing.join(", ")}`);
      }

      setSizes((current) => {
        const map = new Map(current.map((size) => [size.id, size]));
        for (const size of matched) map.set(size.id, size);
        return [...map.values()].sort(
          (left, right) => left.sort_order - right.sort_order,
        );
      });

      const nextSizeIds = [...form.sizeIds];
      for (const size of matched) {
        if (!nextSizeIds.includes(size.id)) nextSizeIds.push(size.id);
      }

      setForm((current) => ({ ...current, sizeIds: nextSizeIds }));
      setSizePricing((current) => {
        const byId = new Map(current.map((row) => [row.sizeId, row]));
        const sizeById = new Map(matched.map((size) => [size.id, size]));
        for (const size of sizes) sizeById.set(size.id, size);
        for (const size of matched) sizeById.set(size.id, size);

        return nextSizeIds.map((sizeId) => {
          const existing = byId.get(sizeId);
          if (existing) return existing;
          const size = sizeById.get(sizeId);
          if (!size) {
            return {
              sizeId,
              sizeCode: "",
              sizeLabel: "?",
              retailPrice: "",
              wholesalePrice: "",
              discountType: "PERCENT" as const,
              discountValue: "",
              costPrice: "",
            };
          }
          const base = createEmptySizePricing(size);
          return form.isRawMaterial
            ? applyRawMaterialPricingRow(base)
            : base;
        });
      });

      setQuickSizeLabels([]);
      setIsStandardSizePanelOpen(false);
      toast.success(`เพิ่ม ${matched.length} ไซส์เข้า Matrix แล้ว`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "เพิ่มไซส์เข้า Matrix ไม่สำเร็จ";
      setFormError(message);
      toast.error(message);
    } finally {
      setIsQuickSizeSaving(false);
    }
  }

  function toggleSize(sizeId: string) {
    if (matrixUsesNaSizeOnly(form)) return;

    const size =
      sizes.find((item) => item.id === sizeId) ??
      globalSizeCatalog.find((item) => item.id === sizeId);
    setForm((current) => {
      const isSelected = current.sizeIds.includes(sizeId);
      return {
        ...current,
        sizeIds: isSelected
          ? current.sizeIds.filter((id) => id !== sizeId)
          : [...current.sizeIds, sizeId],
      };
    });
    setSizePricing((current) => {
      const exists = current.some((row) => row.sizeId === sizeId);
      if (exists) return current.filter((row) => row.sizeId !== sizeId);
      if (!size) return current;
      const base = createEmptySizePricing(size);
      return [
        ...current,
        form.isRawMaterial ? applyRawMaterialPricingRow(base) : base,
      ];
    });
  }

  function updateSizePricing(
    sizeId: string,
    patch: Partial<
      Pick<
        SizePricingRow,
        | "retailPrice"
        | "wholesalePrice"
        | "discountType"
        | "discountValue"
        | "costPrice"
      >
    >,
  ) {
    setSizePricing((current) => {
      const index = current.findIndex((row) => row.sizeId === sizeId);

      if (index === -1) {
        const size = resolveSizeForPricing(sizeId, sizes, globalSizeCatalog);
        if (!size) return current;
        let next: SizePricingRow = {
          ...createEmptySizePricing(size),
          ...patch,
        };

        if (form.isRawMaterial) {
          next = applyRawMaterialPricingRow({
            ...next,
            costPrice: patch.costPrice ?? next.costPrice,
          });
          return [...current, next];
        }

        if (patch.discountType === "NET") {
          return [
            ...current,
            { ...next, discountType: "NET", discountValue: "" },
          ];
        }

        if (patch.costPrice !== undefined && next.discountType === "NET") {
          return [...current, next];
        }

        return [...current, withCalculatedCost(next)];
      }

      return current.map((row) => {
        if (row.sizeId !== sizeId) return row;
        let next = { ...row, ...patch };

        if (form.isRawMaterial) {
          next = applyRawMaterialPricingRow({
            ...next,
            costPrice: patch.costPrice ?? next.costPrice,
          });
          return next;
        }

        // Switching into Net Price: keep current cost as a starting seed
        // the user can edit; clear the unused discount value field.
        if (patch.discountType === "NET") {
          return {
            ...next,
            discountType: "NET",
            discountValue: "",
          };
        }

        // Manual cost edits only apply in Net Price mode.
        if (patch.costPrice !== undefined && next.discountType === "NET") {
          return next;
        }

        return withCalculatedCost(next);
      });
    });
  }

  async function handleSaveDraftModel() {
    setFormError("");

    if (!selectedGender) {
      setFormError("กรุณาเลือกเพศจาก Master Data");
      return;
    }
    if (!baseProductName) {
      setFormError("กรุณาระบุชื่อสินค้า หรือเลือก Brand/Category/Model ให้ครบ");
      return;
    }

    const shortName =
      form.shortName.trim() ||
      selectedCategory?.category_name ||
      `${selectedBrand?.brand_name ?? ""} ${form.modelCode.trim()}`.trim();

    const identity = parseProductModelIdentity({
      vendorId: form.vendorId,
      brandId: form.brandId,
      categoryId: form.categoryId,
      modelCode: form.modelCode,
      name: baseProductName,
      shortName,
      gender: selectedGender.gender_name,
      taxType: form.taxType,
      isService: form.isService,
      isRawMaterial: form.isRawMaterial,
      baseUomId: form.baseUomId,
    });
    if (!identity.ok) {
      setFormError(identity.error);
      return;
    }

    const payload: SaveDraftModelInput = {
      vendorId: identity.data.vendor_id ?? "",
      brandId: identity.data.brand_id ?? "",
      categoryId: identity.data.category_id,
      modelCode: identity.data.model_code,
      name: identity.data.name,
      shortName: identity.data.short_name || shortName,
      gender: identity.data.gender,
      taxType: identity.data.tax_type,
      sizePricingConfig: serializeSizePricingConfig(sizePricing),
      imageUrl: form.imageUrl.trim() || undefined,
      isService: identity.data.is_service,
      isRawMaterial: identity.data.is_raw_material,
      baseUomId: identity.data.base_uom_id,
    };

    setIsDraftSaving(true);

    const check = await findProductModelByCode(payload.modelCode);
    if (!check.ok) {
      setFormError(check.error ?? "ตรวจสอบรหัสรุ่นไม่สำเร็จ");
      toast.error(check.error ?? "ตรวจสอบรหัสรุ่นไม่สำเร็จ");
      setIsDraftSaving(false);
      return;
    }

    if (check.existing) {
      setExistingDraftModel(check.existing);
      setPendingDraftPayload(payload);
      setIsOverwriteModalOpen(true);
      setIsDraftSaving(false);
      return;
    }

    const result = await insertDraftProductModel(payload);
    if (!result.ok || !result.modelId) {
      setFormError(result.error ?? "บันทึกโครงร่างสินค้าไม่สำเร็จ");
      toast.error(result.error ?? "บันทึกโครงร่างสินค้าไม่สำเร็จ");
      setIsDraftSaving(false);
      return;
    }

    setDraftModelId(result.modelId);
    setLoadedModelStatus("DRAFT");
    toast.success("บันทึกโครงร่างสินค้า (DRAFT) สำเร็จ — ยังไม่สร้าง SKU");
    setIsDraftSaving(false);

    const refreshed = await listLoadableProductModels();
    if (refreshed.ok) setLoadableModels(refreshed.models);
  }

  function closeOverwriteModal() {
    if (isDraftSaving) return;
    setIsOverwriteModalOpen(false);
    setExistingDraftModel(null);
    setPendingDraftPayload(null);
  }

  async function handleConfirmOverwriteDraft() {
    if (!pendingDraftPayload) return;

    setIsDraftSaving(true);
    const result = await overwriteDraftProductModel(pendingDraftPayload);

    if (!result.ok || !result.modelId) {
      setFormError(result.error ?? "บันทึกทับโมเดลไม่สำเร็จ");
      toast.error(result.error ?? "บันทึกทับโมเดลไม่สำเร็จ");
      setIsDraftSaving(false);
      return;
    }

    setDraftModelId(result.modelId);
    setLoadedModelStatus("DRAFT");
    setIsOverwriteModalOpen(false);
    setExistingDraftModel(null);
    setPendingDraftPayload(null);
    toast.success("บันทึกทับโมเดลสำเร็จ (DRAFT)");
    setIsDraftSaving(false);

    const refreshed = await listLoadableProductModels();
    if (refreshed.ok) setLoadableModels(refreshed.models);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");

    if (!canGenerateSkus) {
      setFormError(
        "กรุณากรอก Step 1–3 ให้ครบ (สี ไซส์ และราคา) ก่อนสร้าง SKU",
      );
      return;
    }
    if (!selectedGender || !selectedCategory) {
      setFormError("กรุณาเลือก Category / Gender ให้ครบ");
      return;
    }
    if (!form.isService && (!selectedBrand || !form.vendorId)) {
      setFormError("กรุณาเลือก Vendor / Brand ให้ครบ");
      return;
    }
    if (
      new Set(previewRows.map((row) => row.sku)).size !== previewRows.length
    ) {
      setFormError("พบ SKU ซ้ำกันเองใน Matrix กรุณาตรวจสอบรหัสสีและไซส์");
      return;
    }

    const shortName =
      form.shortName.trim() ||
      selectedCategory.category_name ||
      `${selectedBrand?.brand_name ?? ""} ${form.modelCode.trim()}`.trim();

    const identity = parseProductModelIdentity({
      vendorId: form.vendorId,
      brandId: form.brandId,
      categoryId: form.categoryId,
      modelCode: form.modelCode,
      name: baseProductName,
      shortName,
      gender: selectedGender.gender_name,
      taxType: form.taxType,
      isService: form.isService,
      isRawMaterial: form.isRawMaterial,
      baseUomId: form.baseUomId,
    });
    if (!identity.ok) {
      setFormError(identity.error);
      return;
    }

    setIsSaving(true);

    const safeTaxType = identity.data.tax_type;

    const result = await generateSkusFromModel({
      modelId: draftModelId,
      vendorId: identity.data.vendor_id ?? "",
      model: {
        vendorId: identity.data.vendor_id ?? "",
        brandId: identity.data.brand_id ?? "",
        categoryId: identity.data.category_id,
        modelCode: identity.data.model_code,
        name: identity.data.name,
        shortName: identity.data.short_name || shortName,
        gender: identity.data.gender,
        taxType: safeTaxType,
        sizePricingConfig: serializeSizePricingConfig(sizePricing),
        imageUrl: form.imageUrl.trim() || undefined,
        isService: identity.data.is_service,
        isRawMaterial: identity.data.is_raw_material,
        baseUomId: identity.data.base_uom_id,
      },
      skus: previewRows.map((row) => ({
        sku: row.sku,
        name: row.fullName,
        shortName: identity.data.short_name || shortName,
        description: identity.data.name,
        category: selectedCategory.category_name,
        color: row.color.color_name,
        size: row.size.size_label,
        gender: identity.data.gender,
        taxType: safeTaxType,
        costPrice: toPrice(row.prices.cost),
        retailPrice: toPrice(row.prices.retail),
        wholesalePrice: toPrice(row.prices.wholesale),
      })),
    });

    if (!result.ok) {
      if (result.error?.includes("SKU ซ้ำ")) {
        window.alert(result.error);
      }
      setFormError(result.error ?? "สร้าง SKU ไม่สำเร็จ");
      toast.error(result.error ?? "สร้าง SKU ไม่สำเร็จ");
      setIsSaving(false);
      return;
    }

    if (result.modelId) {
      setDraftModelId(result.modelId);
      setLoadedModelStatus("ACTIVE");
    }

    const inserted = result.inserted ?? 0;
    const skipped = result.skipped ?? 0;
    if (inserted === 0 && skipped > 0) {
      toast.success(
        `ไม่มี SKU ใหม่ — ข้าม ${skipped.toLocaleString("th-TH")} รายการที่มีอยู่แล้ว (โมเดลเป็น ACTIVE)`,
      );
    } else {
      toast.success(
        [
          `สร้าง ${inserted.toLocaleString("th-TH")} SKU ใหม่สำเร็จ`,
          skipped > 0
            ? `(ข้าม ${skipped.toLocaleString("th-TH")} รายการที่มีอยู่แล้ว)`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
    await loadProducts();
    setIsSaving(false);
    setIsDialogOpen(false);
  }

  function toggleGroup(groupKey: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
        setExpandedColorGroups((colors) => {
          const pruned = new Set(colors);
          for (const key of colors) {
            if (key.startsWith(`${groupKey}::`)) pruned.delete(key);
          }
          return pruned;
        });
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  function toggleColorGroup(groupKey: string, colorKey: string) {
    const composite = `${groupKey}::${colorKey}`;
    setExpandedColorGroups((current) => {
      const next = new Set(current);
      if (next.has(composite)) next.delete(composite);
      else next.add(composite);
      return next;
    });
  }

  function getGroupVendor(group: ProductGroup): VendorDetail | null {
    for (const product of group.products) {
      const vendor = vendorByProductId[product.id];
      if (vendor) return vendor;
    }
    return null;
  }

  function getGroupBrand(group: ProductGroup): BrandDetail | null {
    for (const product of group.products) {
      const brand = resolveBrandFromSku(product.sku, listBrands);
      if (brand) return brand;
    }
    return null;
  }

  function openDeactivateDialog(group: ProductGroup) {
    setDeactivateError("");
    setDeactivateTarget(group);
  }

  function closeDeactivateDialog() {
    if (isDeactivating) return;
    setDeactivateTarget(null);
    setDeactivateError("");
  }

  async function confirmDeactivateGroup() {
    if (!deactivateTarget) return;
    setIsDeactivating(true);
    setDeactivateError("");

    const ids = deactivateTarget.products.map((product) => product.id);
    const { error } = await supabase
      .from("products")
      .update({ is_active: false })
      .in("id", ids);

    if (error) {
      setDeactivateError(error.message);
      setIsDeactivating(false);
      return;
    }

    await loadProducts();
    setIsDeactivating(false);
    setDeactivateTarget(null);
  }

  function openBatchEdit(group: ProductGroup) {
    const prices: Record<string, SizePrice> = {};
    for (const product of group.products) {
      const sizeLabel = product.size?.trim();
      if (!sizeLabel || prices[sizeLabel]) continue;
      prices[sizeLabel] = {
        cost: priceToInput(Number(product.cost_price)),
        retail: priceToInput(Number(product.retail_price)),
        wholesale: priceToInput(Number(product.wholesale_price)),
      };
    }

    void (async () => {
      try {
        let genders = masterData.genders;
        let vendors = masterData.vendors;
        let uoms = masterData.uoms;

        if (genders.length === 0 || vendors.length === 0 || uoms.length === 0) {
          const [gendersResult, vendorsResult, uomsResult] = await Promise.all([
            genders.length === 0
              ? getGenders()
              : Promise.resolve({ data: genders, error: null }),
            vendors.length === 0
              ? getVendors()
              : Promise.resolve({ data: vendors, error: null }),
            uoms.length === 0
              ? getUoms()
              : Promise.resolve({ data: uoms, error: null }),
          ]);

          if (gendersResult.error) {
            throw new Error(gendersResult.error);
          }
          if (vendorsResult.error) {
            throw new Error(vendorsResult.error);
          }
          if (uomsResult.error) {
            throw new Error(uomsResult.error);
          }

          genders = gendersResult.data;
          vendors = vendorsResult.data;
          uoms = uomsResult.data;
          setMasterData((current) => ({
            ...current,
            genders,
            vendors,
            uoms,
          }));
        }

        const matched =
          genders.find((item) => item.gender_name === group.gender) ??
          genders.find((item) => item.gender_name === "ทั่วไป") ??
          genders[0];

        let vendorId = "";
        let modelCode = "";
        let imageUrl = "";
        let isService = false;
        let isRawMaterial = false;
        let baseUomId = "";
        const modelId =
          group.modelId ??
          group.products.find((item) => item.model_id)?.model_id ??
          null;

        if (modelId) {
          const modelResult = await getProductModelById(modelId);
          if (!modelResult.ok) {
            throw new Error(modelResult.error ?? "โหลดรุ่นสินค้าไม่สำเร็จ");
          }

          vendorId = modelResult.existing?.vendor_id ?? "";
          modelCode = String(modelResult.existing?.model_code ?? "").trim();
          imageUrl = String(modelResult.existing?.image_url ?? "")
            .trim()
            .split("?")[0];
          isService = modelResult.existing?.is_service === true;
          isRawMaterial = modelResult.existing?.is_raw_material === true;
          baseUomId = modelResult.existing?.base_uom_id ?? "";
        } else {
          const mappedVendor = vendorByProductId[group.products[0]?.id ?? ""];
          vendorId = mappedVendor?.id ?? "";
          baseUomId = findPcsUomId(uoms);
        }

        const noneGenderId = findNoneGenderId(genders);
        const genderId = isRawMaterial
          ? noneGenderId || matched?.id || ""
          : matched?.id ?? "";

        setEditTarget(group);
        setBatchEditTab("general");
        setEditForm({
          description: group.title,
          shortName: group.shortName,
          genderId,
          taxType: group.taxType || "INC_VAT",
          vendorId,
          modelCode,
          imageUrl,
          isService,
          isRawMaterial,
          baseUomId,
          prices,
        });
        setEditError("");
        setIsEditConfirmOpen(false);
      } catch (error) {
        setEditError(
          `โหลดข้อมูลแก้ไขไม่สำเร็จ: ${
            error instanceof Error ? error.message : "เกิดข้อผิดพลาด"
          }`,
        );
      }
    })();
  }

  function closeBatchEdit() {
    if (isEditSaving) return;
    setEditTarget(null);
    setEditForm(null);
    setBatchEditTab("general");
    setEditError("");
    setIsEditConfirmOpen(false);
  }

  function updateEditPrice(
    sizeLabel: string,
    key: keyof SizePrice,
    value: string,
  ) {
    setEditForm((current) => {
      if (!current) return current;
      return {
        ...current,
        prices: {
          ...current.prices,
          [sizeLabel]: {
            ...(current.prices[sizeLabel] ?? emptyPrice),
            [key]: value,
          },
        },
      };
    });
  }

  function requestBatchEditSave() {
    if (!editTarget || !editForm) return;
    setEditError("");

    if (!editForm.description.trim()) {
      setEditError("กรุณากรอกชื่อสินค้า (คำอธิบายรุ่น)");
      return;
    }

    if (!editForm.isService) {
      const vendorResult = vendorIdSchema.safeParse(editForm.vendorId.trim());
      if (!vendorResult.success) {
        setEditError(zodFirstError(vendorResult.error, VENDOR_ID_REQUIRED_MESSAGE));
        return;
      }
    }

    for (const sizeLabel of editSizeLabels) {
      const price = editForm.prices[sizeLabel] ?? emptyPrice;
      if (
        price.cost.trim() === "" ||
        price.retail.trim() === "" ||
        price.wholesale.trim() === ""
      ) {
        setEditError(`กรุณากรอกราคาให้ครบสำหรับไซส์ ${sizeLabel}`);
        return;
      }
      if (
        toPrice(price.cost) < 0 ||
        toPrice(price.retail) < 0 ||
        toPrice(price.wholesale) < 0
      ) {
        setEditError(`ราคาของไซส์ ${sizeLabel} ต้องไม่ติดลบ`);
        return;
      }
    }

    setIsEditConfirmOpen(true);
  }

  async function confirmBatchEditSave() {
    if (!editTarget || !editForm) return;
    setIsEditSaving(true);
    setEditError("");

    if (!editForm.isService) {
      const vendorResult = vendorIdSchema.safeParse(editForm.vendorId.trim());
      if (!vendorResult.success) {
        setEditError(zodFirstError(vendorResult.error, VENDOR_ID_REQUIRED_MESSAGE));
        setIsEditSaving(false);
        setIsEditConfirmOpen(false);
        return;
      }
    }

    let safeTaxType: TaxType = "INC_VAT";
    if (typeof editForm.taxType === "string") {
      const taxRaw = editForm.taxType.toUpperCase();
      if (taxRaw.includes("EXC")) safeTaxType = "EXC_VAT";
      else if (taxRaw.includes("NON")) safeTaxType = "NON_VAT";
      else safeTaxType = "INC_VAT";
    }

    const baseName = editForm.description.trim();
    const shortName = editForm.shortName.trim() || baseName;
    const selectedEditGender = masterData.genders.find(
      (item) => item.id === editForm.genderId,
    );
    if (!selectedEditGender) {
      setEditError("กรุณาเลือกเพศจาก Master Data");
      setIsEditSaving(false);
      setIsEditConfirmOpen(false);
      return;
    }

    if (!editForm.baseUomId.trim()) {
      setEditError("กรุณาเลือกหน่วยนับ (UOM)");
      setIsEditSaving(false);
      setIsEditConfirmOpen(false);
      return;
    }

    const modelId =
      editTarget.modelId ??
      editTarget.products.find((item) => item.model_id)?.model_id ??
      null;

    if (!modelId) {
      setEditError(
        "ไม่พบ model_id — ไม่สามารถบันทึกผ่าน Server Action ได้",
      );
      setIsEditSaving(false);
      setIsEditConfirmOpen(false);
      return;
    }

    const sizePrices = editSizeLabels.map((sizeLabel) => {
      const price = editForm.prices[sizeLabel] ?? emptyPrice;
      return {
        sizeCode: sizeLabel,
        sizeLabel,
        costPrice: toPrice(price.cost),
        retailPrice: toPrice(price.retail),
        wholesalePrice: toPrice(price.wholesale),
      };
    });

    const formData = new FormData();
    formData.set("modelId", modelId);
    formData.set("vendorId", editForm.isService ? editForm.vendorId.trim() : editForm.vendorId.trim());
    formData.set("name", baseName);
    formData.set("shortName", shortName);
    formData.set("gender", selectedEditGender.gender_name);
    formData.set("taxType", safeTaxType);
    formData.set(
      "image_url",
      editForm.imageUrl.trim().split("?")[0] || "",
    );
    formData.set("is_service", editForm.isService ? "true" : "false");
    formData.set(
      "is_raw_material",
      editForm.isRawMaterial ? "true" : "false",
    );
    formData.set("base_uom_id", editForm.baseUomId.trim());
    formData.set("sizePrices", JSON.stringify(sizePrices));

    const result = await updateProductModel(formData);
    if (!result.ok) {
      setEditError(result.error ?? "อัปเดตรุ่นสินค้าไม่สำเร็จ");
      setIsEditSaving(false);
      setIsEditConfirmOpen(false);
      return;
    }

    toast.success(
      `บันทึกการแก้ไขทั้งรุ่นแล้ว (${result.updatedSkuCount ?? 0} SKU)`,
    );
    await loadProducts();
    router.refresh();
    setIsEditSaving(false);
    setIsEditConfirmOpen(false);
    setEditTarget(null);
    setEditForm(null);
  }

  const activeCount = products.filter((product) => product.is_active).length;
  const groupCount = productGroups.length;

  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-600">
              <Icon name="sparkles" />
              PRODUCT MASTER
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">
              สินค้าและราคา
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              สร้างสินค้าแบบ Matrix พร้อม Auto-SKU และราคาตามไซส์
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl bg-slate-50 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                สินค้าทั้งหมด
              </p>
              <p className="mt-0.5 text-lg font-bold text-slate-800">
                {products.length.toLocaleString("th-TH")}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-50 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                พร้อมใช้งาน
              </p>
              <p className="mt-0.5 text-lg font-bold text-emerald-700">
                {activeCount.toLocaleString("th-TH")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void openDialog(vendorIdFromQuery)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <Icon name="plus" />
              สร้าง Product Matrix
            </button>
          </div>
        </div>

        {vendorIdFromQuery && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs font-medium text-blue-700">
            <Icon name="sparkles" />
            มาจาก Smart Goods Receipt — คลิก &ldquo;สร้าง Product Matrix&rdquo;
            เพื่อสร้างรุ่นสินค้าใหม่ ระบบเตรียมผู้จำหน่ายไว้ให้แล้ว
          </div>
        )}
      </header>

      <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">รายการสินค้า</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              จัดกลุ่มตามรุ่น → สี ({groupCount.toLocaleString("th-TH")} รุ่น ·{" "}
              {filteredProducts.length.toLocaleString("th-TH")} SKU)
            </p>
          </div>
          <label className="relative block sm:w-80">
            <span className="sr-only">ค้นหาสินค้า</span>
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <Icon name="search" />
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหา SKU, ชื่อรุ่น, สี, ไซส์..."
              className={`${fieldClass} h-9 bg-slate-50 pl-9 text-xs focus:bg-white`}
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left">
            <thead className="border-b border-slate-200 bg-slate-50/80">
              <tr>
                {[
                  "รุ่น / สี / ไซส์",
                  "Vendor",
                  "Brand",
                  "หมวดหมู่ / เพศ",
                  "รายละเอียด",
                  "สถานะ",
                  "จัดการ",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="px-5 py-3 text-[11px] font-semibold tracking-wide text-slate-500"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, row) => (
                  <tr key={row} className="animate-pulse">
                    {Array.from({ length: 7 }).map((__, cell) => (
                      <td key={cell} className="px-5 py-4">
                        <div className="h-3.5 rounded bg-slate-100" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : loadError ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <p className="text-sm font-semibold text-red-600">
                      ไม่สามารถโหลดข้อมูลสินค้าได้
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{loadError}</p>
                    <button
                      type="button"
                      onClick={() => void loadProducts()}
                      className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      ลองอีกครั้ง
                    </button>
                  </td>
                </tr>
              ) : productGroups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <div className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400">
                      <Icon name={search ? "search" : "box"} />
                    </div>
                    <p className="mt-3 text-sm font-medium text-slate-600">
                      {search ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีข้อมูลสินค้า"}
                    </p>
                  </td>
                </tr>
              ) : (
                productGroups.map((group) => {
                  const isExpanded = expandedGroups.has(group.key);
                  const isFullyActive =
                    group.activeCount === group.products.length;
                  const isPartiallyActive =
                    group.activeCount > 0 && !isFullyActive;
                  const groupVendor = getGroupVendor(group);
                  const groupBrand = getGroupBrand(group);

                  return (
                    <Fragment key={group.key}>
                      <tr
                        className="cursor-pointer bg-white transition hover:bg-slate-50/80"
                        onClick={() => openModelPreview(group.modelId)}
                      >
                        <td className="px-5 py-4">
                          <div className="flex max-w-md items-start gap-2 text-left">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleGroup(group.key);
                              }}
                              aria-label={
                                isExpanded ? "ย่อกลุ่มรุ่น" : "ขยายกลุ่มรุ่น"
                              }
                              className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition ${
                                isExpanded
                                  ? "rotate-90 bg-blue-50 text-blue-600"
                                  : ""
                              }`}
                            >
                              <Icon name="chevron" className="size-3.5" />
                            </button>
                            <span>
                              <span className="block text-sm font-semibold text-slate-900">
                                {group.title}
                              </span>
                              {group.shortName ? (
                                <span className="mt-0.5 block text-[11px] text-slate-400">
                                  {group.shortName} · {group.taxType}
                                </span>
                              ) : (
                                <span className="mt-0.5 block text-[11px] text-slate-400">
                                  {group.taxType}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-xs">
                          {groupVendor ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEntitySheet({
                                  kind: "vendor",
                                  data: groupVendor,
                                });
                              }}
                              className="text-left font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 transition hover:text-blue-800 hover:decoration-blue-500"
                            >
                              {groupVendor.company_name}
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-xs">
                          {groupBrand ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEntitySheet({
                                  kind: "brand",
                                  data: groupBrand,
                                });
                              }}
                              className="text-left font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 transition hover:text-blue-800 hover:decoration-blue-500"
                            >
                              {groupBrand.brand_name}
                              <span className="ml-1 font-mono text-[10px] text-blue-500">
                                ({groupBrand.brand_code})
                              </span>
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-600">
                          <p>{group.category || "—"}</p>
                          <p className="mt-0.5 text-slate-400">
                            {group.gender || "—"}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-600">
                          <p>
                            {group.colors.length || 0} สี ×{" "}
                            {group.sizes.length || 0} ไซส์
                          </p>
                          <p className="mt-0.5 font-semibold text-blue-700">
                            {group.products.length.toLocaleString("th-TH")} SKU
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                              isFullyActive
                                ? "text-emerald-700"
                                : isPartiallyActive
                                  ? "text-amber-700"
                                  : "text-slate-400"
                            }`}
                          >
                            <span
                              className={`size-1.5 rounded-full ${
                                isFullyActive
                                  ? "bg-emerald-500"
                                  : isPartiallyActive
                                    ? "bg-amber-500"
                                    : "bg-slate-300"
                              }`}
                            />
                            {isFullyActive
                              ? "ใช้งานทั้งหมด"
                              : isPartiallyActive
                                ? `ใช้งาน ${group.activeCount}/${group.products.length}`
                                : "ปิดใช้งานทั้งหมด"}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openBatchEdit(group);
                              }}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                            >
                              <Icon name="edit" className="size-3.5" />
                              แก้ไขทั้งรุ่น
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDeactivateDialog(group);
                              }}
                              disabled={group.activeCount === 0}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                            >
                              <Icon name="ban" className="size-3.5" />
                              ปิดการใช้งาน
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded &&
                        group.colorGroups.map((colorGroup) => {
                          const colorKey = `${group.key}::${colorGroup.key}`;
                          const isColorExpanded =
                            expandedColorGroups.has(colorKey);
                          const colorFullyActive =
                            colorGroup.activeCount ===
                            colorGroup.products.length;
                          const colorPartiallyActive =
                            colorGroup.activeCount > 0 && !colorFullyActive;

                          return (
                            <Fragment key={colorKey}>
                              <tr className="bg-slate-50/90 hover:bg-slate-50">
                                <td className="px-5 py-3 pl-12" colSpan={4}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleColorGroup(
                                        group.key,
                                        colorGroup.key,
                                      )
                                    }
                                    className="flex items-center gap-2 text-left"
                                  >
                                    <span
                                      className={`grid size-5 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 transition ${
                                        isColorExpanded
                                          ? "rotate-90 bg-blue-50 text-blue-600"
                                          : ""
                                      }`}
                                    >
                                      <Icon
                                        name="chevron"
                                        className="size-3"
                                      />
                                    </span>
                                    <span className="grid size-5 place-items-center rounded-md bg-blue-100 text-blue-700">
                                      <Icon
                                        name="palette"
                                        className="size-3"
                                      />
                                    </span>
                                    <span>
                                      <span className="block text-xs font-semibold text-slate-800">
                                        สี{colorGroup.color}
                                      </span>
                                      <span className="block text-[11px] text-slate-400">
                                        {colorGroup.sizes.length} ไซส์ ·{" "}
                                        {colorGroup.products.length} SKU
                                      </span>
                                    </span>
                                  </button>
                                </td>
                                <td className="px-5 py-3 text-xs text-slate-500">
                                  {colorGroup.sizes.join(", ") || "—"}
                                </td>
                                <td className="px-5 py-3">
                                  <span
                                    className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                                      colorFullyActive
                                        ? "text-emerald-700"
                                        : colorPartiallyActive
                                          ? "text-amber-700"
                                          : "text-slate-400"
                                    }`}
                                  >
                                    <span
                                      className={`size-1.5 rounded-full ${
                                        colorFullyActive
                                          ? "bg-emerald-500"
                                          : colorPartiallyActive
                                            ? "bg-amber-500"
                                            : "bg-slate-300"
                                      }`}
                                    />
                                    {colorFullyActive
                                      ? "ใช้งานทั้งหมด"
                                      : colorPartiallyActive
                                        ? `ใช้งาน ${colorGroup.activeCount}/${colorGroup.products.length}`
                                        : "ปิดใช้งาน"}
                                  </span>
                                </td>
                                <td className="px-5 py-3" />
                              </tr>

                              {isColorExpanded &&
                                colorGroup.products.map((product) => (
                                  <tr
                                    key={product.id}
                                    className="cursor-pointer bg-white hover:bg-blue-50/30"
                                    onClick={() =>
                                      openModelPreview(
                                        product.model_id ?? group.modelId,
                                      )
                                    }
                                  >
                                    <td className="px-5 py-3 pl-20" colSpan={4}>
                                      <p className="text-xs font-medium text-slate-700">
                                        ไซส์ {product.size || "—"}
                                      </p>
                                      <p className="mt-0.5 whitespace-nowrap font-mono text-[11px] font-semibold text-blue-700">
                                        {product.sku}
                                      </p>
                                    </td>
                                    <td className="px-5 py-3 text-right text-[11px] tabular-nums text-slate-600">
                                      <div>
                                        ต้นทุน{" "}
                                        {baht.format(Number(product.cost_price))}
                                      </div>
                                      <div>
                                        ปลีก{" "}
                                        {baht.format(
                                          Number(product.retail_price),
                                        )}{" "}
                                        · ส่ง{" "}
                                        {baht.format(
                                          Number(product.wholesale_price),
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-5 py-3" colSpan={2}>
                                      <span
                                        className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                                          product.is_active
                                            ? "text-emerald-700"
                                            : "text-slate-400"
                                        }`}
                                      >
                                        <span
                                          className={`size-1.5 rounded-full ${
                                            product.is_active
                                              ? "bg-emerald-500"
                                              : "bg-slate-300"
                                          }`}
                                        />
                                        {product.is_active
                                          ? "ใช้งาน"
                                          : "ปิดใช้งาน"}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                            </Fragment>
                          );
                        })}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isDialogOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="matrix-dialog-title"
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]"
          >
            <div className="flex shrink-0 items-start justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7 sm:py-5">
              <div className="flex items-start gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  <Icon name="layers" className="size-5" />
                </div>
                <div>
                  <h2
                    id="matrix-dialog-title"
                    className="text-lg font-bold text-slate-950"
                  >
                    Product Matrix Generator
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    สร้างหลาย SKU จากสีและไซส์ในครั้งเดียว
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={isSaving || isDraftSaving}
                aria-label="ปิดหน้าต่าง"
                className="grid size-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <Icon name="close" className="size-5" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <StepHeading
                    number={1}
                    title="ข้อมูลหลักสินค้า (Model Info)"
                    description="โหลดโมเดลเดิม (DRAFT/ACTIVE) หรือสร้างใหม่จาก Master Data"
                  />

                  <ProductModelImageUpload
                    className="mb-4"
                    value={form.imageUrl}
                    modelCode={form.modelCode}
                    disabled={isMasterLoading || isSaving || isDraftSaving}
                    onChange={(url) => updateForm("imageUrl", url)}
                  />

                  <ProductMatrixServiceToggle
                    className="mb-4"
                    checked={form.isService}
                    disabled={isMasterLoading || isSaving || isDraftSaving}
                    onCheckedChange={(checked) =>
                      updateForm("isService", checked)
                    }
                  />

                  <ProductMatrixRawMaterialToggle
                    className="mb-4"
                    checked={form.isRawMaterial}
                    disabled={isMasterLoading || isSaving || isDraftSaving}
                    onCheckedChange={(checked) => {
                      const noneGenderId = findNoneGenderId(masterData.genders);
                      const pcsUomId = findPcsUomId(masterData.uoms);
                      setForm((current) => ({
                        ...current,
                        isRawMaterial: checked,
                        genderId: checked
                          ? noneGenderId || current.genderId
                          : current.genderId,
                        baseUomId: checked
                          ? ""
                          : current.baseUomId || pcsUomId,
                      }));
                      if (checked) {
                        setSizePricing((current) =>
                          current.map((row) => applyRawMaterialPricingRow(row)),
                        );
                      }
                    }}
                  />

                  <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className={labelClass + " mb-0"}>
                        ค้นหาโครงร่าง / รุ่นสินค้า (Load Model)
                      </span>
                      {loadedModelStatus && (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            loadedModelStatus === "ACTIVE"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {loadedModelStatus}
                        </span>
                      )}
                    </div>
                    <ModelLoadCombobox
                      models={loadableModels}
                      value={draftModelId ?? ""}
                      isLoading={isLoadableModelsLoading}
                      disabled={isMasterLoading || isSaving || isDraftSaving}
                      onChange={(modelId, model) =>
                        void handleLoadModel(modelId, model)
                      }
                    />
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      แสดงโมเดลสถานะ DRAFT และ ACTIVE — โหลดแล้วเพิ่มสีใหม่ได้
                      ระบบจะข้าม SKU ที่มีอยู่แล้ว
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                    {!form.isService ? (
                      <>
                    <ProductMatrixVendorField
                      className="sm:col-span-2"
                      disabled={isMasterLoading}
                      vendors={masterData.vendors}
                      value={form.vendorId}
                      onChange={(vendorId) => updateForm("vendorId", vendorId)}
                      onVendorsChange={(vendors) =>
                        setMasterData((current) => ({
                          ...current,
                          vendors,
                        }))
                      }
                      error={
                        formError.includes("vendor_id") ||
                        formError.includes("ผู้จำหน่าย")
                          ? formError
                          : null
                      }
                    />
                    <div className="relative block sm:col-span-1 lg:col-span-2">
                      <span className={labelClass}>
                        แบรนด์ (Brand) <span className="text-red-500">*</span>
                      </span>
                      <BrandCombobox
                        required
                        disabled={isMasterLoading}
                        brands={masterData.brands}
                        value={form.brandId}
                        onChange={changeBrand}
                        onBrandsChange={(brands) =>
                          setMasterData((current) => ({
                            ...current,
                            brands,
                          }))
                        }
                      />
                    </div>
                      </>
                    ) : (
                      <p className="sm:col-span-2 lg:col-span-6 rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-[11px] text-violet-800">
                        งานบริการ — ไม่ต้องระบุผู้จำหน่ายและแบรนด์ (ไม่ตัดสต็อก)
                      </p>
                    )}
                    <div className="relative block sm:col-span-1 lg:col-span-2">
                      <span className={labelClass}>
                        หมวดหมู่ (Category){" "}
                        <span className="text-red-500">*</span>
                      </span>
                      <CategoryCombobox
                        required
                        disabled={isMasterLoading}
                        categories={masterData.categories}
                        value={form.categoryId}
                        onChange={(categoryId) =>
                          updateForm("categoryId", categoryId)
                        }
                        onCategoriesChange={(categories) =>
                          setMasterData((current) => ({
                            ...current,
                            categories,
                          }))
                        }
                      />
                    </div>
                    {form.isRawMaterial ? (
                      <div className="block lg:col-span-1">
                        <span className={labelClass}>เพศ (Gender)</span>
                        <div className="flex h-10 items-center rounded-xl border border-amber-200 bg-amber-50/70 px-3 text-sm font-medium text-amber-900">
                          N — None/ไม่ระบุ
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">
                          วัตถุดิบล็อก Gender เป็น N อัตโนมัติ
                        </p>
                      </div>
                    ) : (
                      <label className="block lg:col-span-1">
                        <span className={labelClass}>
                          เพศ (Gender) <span className="text-red-500">*</span>
                        </span>
                        <select
                          required
                          disabled={isMasterLoading}
                          value={form.genderId}
                          onChange={(event) =>
                            updateForm("genderId", event.target.value)
                          }
                          className={fieldClass}
                        >
                          <option value="">
                            {isMasterLoading ? "กำลังโหลด..." : "เลือกเพศ"}
                          </option>
                          {masterData.genders.map((gender) => (
                            <option key={gender.id} value={gender.id}>
                              {formatGenderOption(gender)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="block lg:col-span-1">
                      <span className={labelClass}>
                        หน่วยนับ (UOM) <span className="text-red-500">*</span>
                      </span>
                      <select
                        required
                        disabled={isMasterLoading}
                        value={form.baseUomId}
                        onChange={(event) =>
                          updateForm("baseUomId", event.target.value)
                        }
                        className={fieldClass}
                      >
                        <option value="">
                          {form.isRawMaterial
                            ? "เลือกหน่วยนับวัตถุดิบ"
                            : isMasterLoading
                              ? "กำลังโหลด..."
                              : "เลือกหน่วยนับ"}
                        </option>
                        {masterData.uoms.map((uom) => (
                          <option key={uom.uom_id} value={uom.uom_id}>
                            {uom.uom_code} — {uom.uom_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className={labelClass}>ประเภทภาษี (Tax Type)</span>
                      <select
                        value={form.taxType}
                        onChange={(event) =>
                          updateForm("taxType", event.target.value as TaxType)
                        }
                        className={fieldClass}
                      >
                        {TAX_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block lg:col-span-3">
                      <span className={labelClass}>
                        ชื่อรุ่น / รหัสรุ่น ({MODEL_CODE_LENGTH} ตัวอักษร){" "}
                        <span className="text-red-500">*</span>
                      </span>
                      <input
                        required
                        value={form.modelCode}
                        maxLength={MODEL_CODE_LENGTH}
                        onChange={(event) =>
                          updateForm("modelCode", event.target.value)
                        }
                        placeholder="เช่น 6401AB"
                        className={`${fieldClass} font-mono`}
                      />
                      <span
                        className={`mt-1 block text-[11px] ${
                          form.modelCode && !isValidModelCode(form.modelCode)
                            ? "font-medium text-red-600"
                            : "text-slate-400"
                        }`}
                      >
                        ต้องยาวพอดี {MODEL_CODE_LENGTH} ตัวอักษร (ปัจจุบัน{" "}
                        {form.modelCode.trim().length})
                      </span>
                    </label>
                    <label className="block sm:col-span-2 lg:col-span-4">
                      <span className={labelClass}>ชื่อสินค้า (คำอธิบาย)</span>
                      <input
                        value={form.productName}
                        onChange={(event) => {
                          setProductNameTouched(true);
                          updateForm("productName", event.target.value);
                        }}
                        placeholder={
                          selectedCategory && isValidModelCode(form.modelCode)
                            ? `${selectedCategory.category_name} ${form.modelCode.trim()}`
                            : "เช่น เสื้อโปโล 6401AB"
                        }
                        className={fieldClass}
                      />
                      <span className="mt-1 block text-[11px] text-slate-400">
                        Auto-fill เมื่อ model_code ครบ 6 ตัว: หมวดหมู่ + รหัสรุ่น
                        (แก้ไขได้)
                      </span>
                    </label>
                    <label className="block sm:col-span-2 lg:col-span-2">
                      <span className={labelClass}>
                        ชื่อย่อสินค้า (Short Name)
                      </span>
                      <input
                        value={form.shortName}
                        onChange={(event) => {
                          setShortNameTouched(true);
                          updateForm("shortName", event.target.value);
                        }}
                        placeholder={
                          selectedCategory?.category_name || "เช่น เสื้อโปโล"
                        }
                        className={fieldClass}
                      />
                      <span className="mt-1 block text-[11px] text-slate-400">
                        Auto-fill จากชื่อหมวดหมู่เมื่อยังไม่ได้แก้
                      </span>
                    </label>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-slate-500">
                      {draftModelId ? (
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                          <span
                            className={`size-1.5 rounded-full ${
                              loadedModelStatus === "ACTIVE"
                                ? "bg-emerald-500"
                                : "bg-amber-500"
                            }`}
                          />
                          โหลดแล้ว ·{" "}
                          <span className="font-bold uppercase">
                            {loadedModelStatus ?? "DRAFT"}
                          </span>
                        </span>
                      ) : (
                        <span>
                          Phase 1: บันทึก Base Model ลง{" "}
                          <code className="rounded bg-slate-100 px-1">
                            product_models
                          </code>{" "}
                          โดยยังไม่สร้าง SKU
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveDraftModel()}
                      disabled={
                        isDraftSaving ||
                        isSaving ||
                        isMasterLoading ||
                        !isStep1Complete
                      }
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDraftSaving
                        ? "กำลังบันทึกโครงร่าง..."
                        : "บันทึกโครงร่างสินค้า (Save Draft Model)"}
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <StepHeading
                    number={2}
                    title="สีและไซส์ (Matrix Setup)"
                    description="เลือกตัวเลือกที่ต้องการ ระบบจะจับคู่เป็น Matrix ให้อัตโนมัติ"
                  />
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div>
                      <span className={labelClass}>
                        สี (เลือกได้หลายสี){" "}
                        <span className="text-red-500">*</span>
                      </span>
                      <SmartColorCombobox
                        colors={masterData.colors}
                        value={form.colorIds}
                        onChange={(colorIds) =>
                          setForm((current) => ({ ...current, colorIds }))
                        }
                        onColorsChange={(colors) =>
                          setMasterData((current) => ({ ...current, colors }))
                        }
                        disabled={isMasterLoading || isSaving}
                      />
                      <p className="mt-1.5 text-[11px] text-slate-400">
                        รหัสสีใหม่ต้องเป็นตัวอักษรอังกฤษ 3 ตัวพอดี (เช่น BLK, RED)
                      </p>
                    </div>

                    <div>
                      {matrixUsesNaSizeOnlyFlag ? (
                        <>
                          <span className={labelClass}>ไซส์ (Matrix)</span>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <p className="text-xs font-semibold text-slate-700">
                              00 — N/A (ไม่ใช้ไซส์เสื้อผ้า)
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {form.isRawMaterial
                                ? "วัตถุดิบใช้ไซส์ระบบ 00 อัตโนมัติ — สร้าง 1 SKU ต่อ 1 สี"
                                : "สินค้าบริการใช้ไซส์ระบบ 00 อัตโนมัติ — สร้าง 1 SKU ต่อ 1 สี"}
                            </p>
                            {systemNaSize ? (
                              <span className="mt-2 inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 font-mono text-xs font-semibold text-blue-800">
                                {systemNaSize.size_label} ({systemNaSize.size_code})
                              </span>
                            ) : (
                              <p className="mt-2 text-xs text-amber-700">
                                กำลังโหลดไซส์ระบบ 00...
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-slate-700">
                          ไซส์ (Global Size){" "}
                          <span className="text-red-500">*</span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={openCreateMasterSizeDialog}
                            disabled={isMasterLoading || isSaving}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            + Master Size
                          </button>
                          <button
                            type="button"
                            onClick={() => void openStandardSizePanel()}
                            disabled={
                              (!form.brandId && !form.isService) ||
                              isMasterLoading ||
                              isSaving ||
                              isSizeLoading ||
                              isGlobalSizeLoading
                            }
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            + เพิ่มไซส์
                          </button>
                        </div>
                      </div>
                      {!form.brandId && !form.isService ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs text-slate-400">
                          กรุณาเลือกแบรนด์ก่อน
                        </div>
                      ) : isSizeLoading ? (
                        <div className="rounded-xl bg-slate-50 px-4 py-5 text-center text-xs text-slate-400">
                          กำลังโหลดไซส์...
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {form.sizeIds.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {sizes
                                .filter((size) =>
                                  form.sizeIds.includes(size.id),
                                )
                                .map((size) => {
                                  const checked = form.sizeIds.includes(
                                    size.id,
                                  );
                                  return (
                                    <button
                                      type="button"
                                      key={size.id}
                                      aria-pressed={checked}
                                      onClick={() => toggleSize(size.id)}
                                      className={`inline-flex min-w-16 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                                        checked
                                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                                          : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                                      }`}
                                    >
                                      {checked && (
                                        <Icon
                                          name="check"
                                          className="size-3.5"
                                        />
                                      )}
                                      {size.size_label}
                                    </button>
                                  );
                                })}
                            </div>
                          ) : (
                            !isStandardSizePanelOpen && (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs text-slate-400">
                                กด &quot;+ เพิ่มไซส์&quot;
                                เพื่อเลือกไซส์มาตรฐานเข้า Matrix
                              </div>
                            )
                          )}

                          {isStandardSizePanelOpen && (
                            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                              <div className="mb-3 flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-xs font-semibold text-slate-800">
                                    เลือกไซส์มาตรฐานเพื่อเพิ่มใน Matrix
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    เลือกจากแคตตาล็อก Global Size
                                    ที่มีในระบบแล้ว — สร้าง/แก้ไขรหัสไซส์ใช้ปุ่ม
                                    &quot;+ Master Size&quot;
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsStandardSizePanelOpen(false);
                                    setQuickSizeLabels([]);
                                  }}
                                  disabled={isQuickSizeSaving}
                                  aria-label="ปิดแผงเลือกไซส์"
                                  className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:opacity-50"
                                >
                                  <Icon name="close" className="size-4" />
                                </button>
                              </div>

                              {isGlobalSizeLoading ? (
                                <div className="rounded-xl bg-white/70 px-4 py-6 text-center text-xs text-slate-400">
                                  กำลังโหลดไซส์มาตรฐาน...
                                </div>
                              ) : kidsSizes.length === 0 &&
                                adultSizes.length === 0 &&
                                serviceCustomSizes.length === 0 ? (
                                <div className="rounded-xl bg-white/70 px-4 py-6 text-center text-xs text-slate-400">
                                  ไม่พบไซส์ในแคตตาล็อก Global Size
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  {kidsSizes.length > 0 ? (
                                    <div>
                                      <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-500">
                                        ไซส์เด็ก (K / J)
                                      </p>
                                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                                        {kidsSizes.map((size) => {
                                          const checked =
                                            quickSizeLabels.includes(
                                              size.size_label,
                                            );
                                          return (
                                            <label
                                              key={size.id}
                                              className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                                                checked
                                                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                                                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() =>
                                                  toggleQuickSize(
                                                    size.size_label,
                                                  )
                                                }
                                                className="sr-only"
                                              />
                                              {size.size_label}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}

                                  {adultSizes.length > 0 ? (
                                    <div>
                                      <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-500">
                                        ไซส์ผู้ใหญ่
                                      </p>
                                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                                        {adultSizes.map((size) => {
                                          const checked =
                                            quickSizeLabels.includes(
                                              size.size_label,
                                            );
                                          return (
                                            <label
                                              key={size.id}
                                              className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                                                checked
                                                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                                                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() =>
                                                  toggleQuickSize(
                                                    size.size_label,
                                                  )
                                                }
                                                className="sr-only"
                                              />
                                              {size.size_label}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}

                                  {/* 3rd category — Service/Custom (sort_order >= 900) from DB only */}
                                  <div>
                                    <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-500">
                                      {SERVICE_CUSTOM_SIZE_GROUP_TITLE}
                                    </p>
                                    {serviceCustomSizes.length === 0 ? (
                                      <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-4 text-center text-[11px] text-slate-400">
                                        ยังไม่มีไซส์งานบริการในระบบ (sort_order ≥
                                        900)
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                                        {serviceCustomSizes.map((size) => {
                                          const checked =
                                            quickSizeLabels.includes(
                                              size.size_label,
                                            );
                                          return (
                                            <label
                                              key={size.id}
                                              className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                                                checked
                                                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                                                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() =>
                                                  toggleQuickSize(
                                                    size.size_label,
                                                  )
                                                }
                                                className="sr-only"
                                              />
                                              {size.size_label}
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                                <p className="text-[11px] text-slate-500">
                                  เลือกแล้ว {quickSizeLabels.length} ไซส์
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleConfirmStandardSizes()
                                  }
                                  disabled={
                                    quickSizeLabels.length === 0 ||
                                    isQuickSizeSaving ||
                                    isGlobalSizeLoading
                                  }
                                  className="inline-flex h-9 items-center justify-center rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                                >
                                  {isQuickSizeSaving
                                    ? "กำลังเพิ่ม..."
                                    : `ยืนยันเพิ่ม ${quickSizeLabels.length} ไซส์`}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <StepHeading
                    number={3}
                    title="ราคาตามไซส์"
                    description={
                      form.isRawMaterial
                        ? "วัตถุดิบ — กรอกราคาต้นทุนเท่านั้น (ราคาขายปลีก/ส่งและส่วนลดล็อกที่ 0)"
                        : "ต้นทุนคำนวณอัตโนมัติจากราคาปลีกและส่วนลด — หรือเลือก “ราคาเน็ต” เพื่อพิมพ์ต้นทุนตรงๆ (ใช้กับทุกสีในไซส์เดียวกัน)"
                    }
                  />
                  {form.isRawMaterial && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900">
                      สินค้ารหัสนี้เป็นวัตถุดิบ (Raw Material) ระบบจะอนุญาตให้กำหนดเฉพาะราคาต้นทุนเท่านั้น
                    </div>
                  )}
                  {form.sizeIds.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
                      เลือกไซส์เพื่อกำหนดราคา
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[860px]">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                              ไซส์
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                              ราคาขายปลีก
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                              ราคาขายส่ง
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                              ประเภทส่วนลด
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                              ค่าส่วนลด
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                              ราคาต้นทุน
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sizes
                            .filter((size) => form.sizeIds.includes(size.id))
                            .map((size) => {
                              const pricing =
                                sizePricingById.get(size.id) ??
                                (form.isRawMaterial
                                  ? applyRawMaterialPricingRow(
                                      createEmptySizePricing(size),
                                    )
                                  : createEmptySizePricing(size));
                              const isNetPrice =
                                pricing.discountType === "NET" || form.isRawMaterial;
                              const rawMaterialLocked = form.isRawMaterial;
                              return (
                                <tr key={size.id}>
                                  <td className="px-4 py-3">
                                    <span className="font-semibold text-slate-800">
                                      {size.size_label}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openEditMasterSizeDialog(size)
                                      }
                                      title="แก้ไขไซส์ใน Master Data"
                                      className="ml-2 font-mono text-[10px] text-blue-600 underline-offset-2 hover:underline"
                                    >
                                      {size.size_code}
                                    </button>
                                  </td>
                                  <td className="px-4 py-3">
                                    <PriceInput
                                      value={pricing.retailPrice}
                                      ariaLabel={`ราคาขายปลีกไซส์ ${size.size_label}`}
                                      disabled={rawMaterialLocked}
                                      onChange={(value) =>
                                        updateSizePricing(size.id, {
                                          retailPrice: value,
                                        })
                                      }
                                    />
                                  </td>
                                  <td className="px-4 py-3">
                                    <PriceInput
                                      value={pricing.wholesalePrice}
                                      ariaLabel={`ราคาขายส่งไซส์ ${size.size_label}`}
                                      disabled={rawMaterialLocked}
                                      onChange={(value) =>
                                        updateSizePricing(size.id, {
                                          wholesalePrice: value,
                                        })
                                      }
                                    />
                                  </td>
                                  <td className="px-4 py-3">
                                    <select
                                      aria-label={`ประเภทส่วนลดไซส์ ${size.size_label}`}
                                      value={pricing.discountType}
                                      disabled={rawMaterialLocked}
                                      onChange={(event) =>
                                        updateSizePricing(size.id, {
                                          discountType: event.target
                                            .value as DiscountType,
                                        })
                                      }
                                      className={fieldClass}
                                    >
                                      <option value="PERCENT">%</option>
                                      <option value="THB">THB</option>
                                      <option value="NET">ราคาเน็ต</option>
                                    </select>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="relative">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        aria-label={`ค่าส่วนลดไซส์ ${size.size_label}`}
                                        value={pricing.discountValue}
                                        disabled={isNetPrice || rawMaterialLocked}
                                        readOnly={isNetPrice || rawMaterialLocked}
                                        onChange={(event) =>
                                          updateSizePricing(size.id, {
                                            discountValue: event.target.value,
                                          })
                                        }
                                        placeholder={isNetPrice ? "—" : "0"}
                                        className={`${fieldClass} pr-10 text-right tabular-nums ${
                                          isNetPrice || rawMaterialLocked
                                            ? "cursor-not-allowed bg-slate-50 text-slate-400"
                                            : ""
                                        }`}
                                      />
                                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                                        {isNetPrice
                                          ? ""
                                          : pricing.discountType === "PERCENT"
                                            ? "%"
                                            : "฿"}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <PriceInput
                                      value={pricing.costPrice}
                                      ariaLabel={`ราคาต้นทุนไซส์ ${size.size_label}`}
                                      disabled={!isNetPrice}
                                      onChange={(value) =>
                                        updateSizePricing(size.id, {
                                          costPrice: value,
                                        })
                                      }
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-4">
                    <StepHeading
                      number={4}
                      title="Preview และ Auto-SKU"
                      description="SKU = แบรนด์ + หมวดหมู่(2) + รุ่น(6) + เพศ(1) + สี(3) + ไซส์(2)"
                    />
                    <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      {previewRows.length.toLocaleString("th-TH")} SKU
                    </span>
                  </div>
                  {previewRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                      <Icon
                        name="layers"
                        className="mx-auto size-6 text-slate-300"
                      />
                      <p className="mt-2 text-xs text-slate-400">
                        กรอกข้อมูลรุ่น แล้วเลือกสีและไซส์เพื่อดู Preview
                      </p>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[860px] text-left">
                        <thead className="sticky top-0 z-10 bg-slate-50">
                          <tr>
                            {[
                              "SKU อัตโนมัติ",
                              "ชื่อสินค้าเต็ม",
                              "สี",
                              "ไซส์",
                              "ต้นทุน",
                              "ขายปลีก",
                              "ขายส่ง",
                            ].map((heading) => (
                              <th
                                key={heading}
                                className="border-b border-slate-200 px-4 py-3 text-[11px] font-semibold text-slate-500"
                              >
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewRows.map((row) => (
                            <tr key={row.key} className="hover:bg-slate-50">
                              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold text-blue-700">
                                {row.sku}
                              </td>
                              <td className="px-4 py-3 text-xs font-medium text-slate-700">
                                {row.fullName}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-600">
                                {row.color.color_name}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-600">
                                {row.size.size_label}
                              </td>
                              {[
                                row.prices.cost,
                                row.prices.retail,
                                row.prices.wholesale,
                              ].map((price, index) => (
                                <td
                                  key={index}
                                  className="px-4 py-3 text-right text-xs tabular-nums text-slate-600"
                                >
                                  {baht.format(toPrice(price))}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {formError && (
                  <div
                    role="alert"
                    className="whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"
                  >
                    {formError}
                  </div>
                )}
              </div>

              <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                <p className="text-xs text-slate-500">
                  Phase 2: สร้าง SKU จากสูตร Brand+Category(2)+Model(6)+Gender(1)+Color(3)+Size(2) —
                  SKU ที่มีอยู่แล้วจะถูกข้ามอัตโนมัติ (
                  <strong className="text-slate-800">
                    {previewRows.length}
                  </strong>{" "}
                  รายการใน Preview)
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={isSaving || isDraftSaving}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSaving ||
                      isDraftSaving ||
                      isMasterLoading ||
                      !canGenerateSkus
                    }
                    className="inline-flex h-10 min-w-40 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {isSaving ? (
                      "กำลังสร้าง SKU..."
                    ) : (
                      <>
                        <Icon name="sparkles" />
                        สร้าง {previewRows.length} SKU
                      </>
                    )}
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}

      {deactivateTarget && (
        <div
          role="presentation"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeactivateDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="deactivate-dialog-title"
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h3
                id="deactivate-dialog-title"
                className="text-sm font-bold text-slate-900"
              >
                ยืนยันการปิดการใช้งาน
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                คุณต้องการปิดการใช้งานสินค้ากลุ่มนี้ ใช่หรือไม่?
                (สามารถเปิดใหม่ได้ภายหลัง)
              </p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">
                  {deactivateTarget.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  จะปิดการใช้งาน{" "}
                  {deactivateTarget.products.length.toLocaleString("th-TH")} SKU
                  ในกลุ่มนี้
                </p>
              </div>
              {deactivateError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                >
                  {deactivateError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={closeDeactivateDialog}
                disabled={isDeactivating}
                className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => void confirmDeactivateGroup()}
                disabled={isDeactivating}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-4 text-xs font-semibold text-white transition hover:bg-red-700 disabled:bg-red-300"
              >
                {isDeactivating ? (
                  "กำลังปิดการใช้งาน..."
                ) : (
                  <>
                    <Icon name="ban" className="size-3.5" />
                    ยืนยันปิดใช้งาน
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && editForm && (
        <div
          role="presentation"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeBatchEdit();
          }}
        >
          {(() => {
            const editModelId =
              editTarget.modelId ??
              editTarget.products.find((item) => item.model_id)?.model_id ??
              "";
            const showBomTab =
              !editForm.isService &&
              !editForm.isRawMaterial &&
              Boolean(editModelId);

            return (
          <>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-edit-dialog-title"
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]"
          >
            <div className="flex shrink-0 items-start justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7 sm:py-5">
              <div className="flex items-start gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  <Icon name="edit" className="size-5" />
                </div>
                <div>
                  <h2
                    id="batch-edit-dialog-title"
                    className="text-lg font-bold text-slate-950"
                  >
                    แก้ไขทั้งรุ่น
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    อัปเดตชื่อและราคาของทุก SKU ในกลุ่ม (
                    {editTarget.products.length.toLocaleString("th-TH")} รายการ)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeBatchEdit}
                disabled={isEditSaving}
                aria-label="ปิดหน้าต่างแก้ไข"
                className="grid size-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <Icon name="close" className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <Tabs
                value={
                  showBomTab ? batchEditTab : "general"
                }
                onValueChange={(value) => {
                  if (value === "general" || value === "bom") {
                    setBatchEditTab(value);
                  }
                }}
                className="space-y-4"
              >
                <TabsList
                  className={
                    showBomTab ? "grid w-full max-w-lg grid-cols-2" : "max-w-lg"
                  }
                >
                  <TabsTrigger value="general">ข้อมูลรุ่น</TabsTrigger>
                  {showBomTab ? (
                    <TabsTrigger value="bom">สูตรการผลิต (BOM)</TabsTrigger>
                  ) : null}
                </TabsList>

                <TabsContent value="general" className="mt-0 space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <StepHeading
                  number={1}
                  title="ข้อมูลรุ่นสินค้า"
                  description="แก้ไขชื่อรุ่นและข้อมูลหลักที่ใช้ร่วมกันทั้งกลุ่ม"
                />

                <ProductModelImageUpload
                  className="mb-4"
                  value={editForm.imageUrl}
                  modelCode={editForm.modelCode}
                  disabled={isEditSaving}
                  onChange={(url) =>
                    setEditForm((current) =>
                      current ? { ...current, imageUrl: url } : current,
                    )
                  }
                />

                <ProductMatrixServiceToggle
                  className="mb-4"
                  checked={editForm.isService}
                  disabled={isEditSaving}
                  onCheckedChange={(checked) => {
                    setBatchEditTab("general");
                    setEditForm((current) =>
                      current ? { ...current, isService: checked } : current,
                    );
                  }}
                />

                <ProductMatrixRawMaterialToggle
                  className="mb-4"
                  checked={editForm.isRawMaterial}
                  disabled={isEditSaving}
                    onCheckedChange={(checked) => {
                      const noneGenderId = findNoneGenderId(masterData.genders);
                      const pcsUomId = findPcsUomId(masterData.uoms);
                      setBatchEditTab("general");
                      setEditForm((current) =>
                        current
                          ? {
                              ...current,
                              isRawMaterial: checked,
                              genderId: checked
                                ? noneGenderId || current.genderId
                                : current.genderId,
                              baseUomId: checked
                                ? ""
                                : current.baseUomId || pcsUomId,
                            }
                          : current,
                      );
                    }}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className={labelClass}>
                      ชื่อสินค้า (คำอธิบายรุ่น){" "}
                      <span className="text-red-500">*</span>
                    </span>
                    <input
                      value={editForm.description}
                      onChange={(event) =>
                        setEditForm((current) =>
                          current
                            ? { ...current, description: event.target.value }
                            : current,
                        )
                      }
                      className={fieldClass}
                      placeholder="เช่น เสื้อโปโล Portman 6401"
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>ชื่อย่อสินค้า</span>
                    <input
                      value={editForm.shortName}
                      onChange={(event) =>
                        setEditForm((current) =>
                          current
                            ? { ...current, shortName: event.target.value }
                            : current,
                        )
                      }
                      className={fieldClass}
                      placeholder="เช่น Portman 6401"
                    />
                  </label>
                  {editForm.isRawMaterial ? (
                    <div className="block">
                      <span className={labelClass}>เพศ</span>
                      <div className="flex h-10 items-center rounded-xl border border-amber-200 bg-amber-50/70 px-3 text-sm font-medium text-amber-900">
                        N — None/ไม่ระบุ
                      </div>
                    </div>
                  ) : (
                    <label className="block">
                      <span className={labelClass}>เพศ</span>
                      <select
                        value={editForm.genderId}
                        onChange={(event) =>
                          setEditForm((current) =>
                            current
                              ? {
                                  ...current,
                                  genderId: event.target.value,
                                }
                              : current,
                          )
                        }
                        className={fieldClass}
                      >
                        <option value="">เลือกเพศ</option>
                        {masterData.genders.map((gender) => (
                          <option key={gender.id} value={gender.id}>
                            {formatGenderOption(gender)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="block">
                    <span className={labelClass}>
                      หน่วยนับ (UOM) <span className="text-red-500">*</span>
                    </span>
                    <select
                      required
                      disabled={isEditSaving}
                      value={editForm.baseUomId}
                      onChange={(event) =>
                        setEditForm((current) =>
                          current
                            ? { ...current, baseUomId: event.target.value }
                            : current,
                        )
                      }
                      className={fieldClass}
                    >
                      <option value="">เลือกหน่วยนับ</option>
                      {masterData.uoms.map((uom) => (
                        <option key={uom.uom_id} value={uom.uom_id}>
                          {uom.uom_code} — {uom.uom_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className={labelClass}>ประเภทภาษี</span>
                    <select
                      value={editForm.taxType}
                      onChange={(event) =>
                        setEditForm((current) =>
                          current
                            ? {
                                ...current,
                                taxType: event.target.value as TaxType,
                              }
                            : current,
                        )
                      }
                      className={fieldClass}
                    >
                      {TAX_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="block sm:col-span-2">
                    {editForm.isService ? (
                      <p className="rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-[11px] text-violet-800">
                        งานบริการ — ไม่ต้องระบุผู้จำหน่าย (ไม่ตัดสต็อก)
                      </p>
                    ) : (
                    <ProductMatrixVendorField
                      vendors={masterData.vendors}
                      value={editForm.vendorId}
                      onChange={(vendorId) =>
                        setEditForm((current) =>
                          current ? { ...current, vendorId } : current,
                        )
                      }
                      onVendorsChange={(vendors) =>
                        setMasterData((current) => ({
                          ...current,
                          vendors,
                        }))
                      }
                      disabled={isEditSaving}
                      error={
                        editError.includes("vendor_id") ||
                        editError.includes("ผู้จำหน่าย")
                          ? editError
                          : null
                      }
                      hint="บังคับ (UUID) — บันทึกลง product_models.vendor_id สำหรับ Bulk Mapping / Goods Receipt"
                    />
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <StepHeading
                  number={2}
                  title="ราคาตามไซส์"
                  description="ราคานี้จะอัปเดตทุกสีในไซส์เดียวกันทั้งกลุ่ม"
                />
                {editSizeLabels.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
                    ไม่พบข้อมูลไซส์ในกลุ่มนี้
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[620px]">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                            ไซส์
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                            ราคาต้นทุน
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                            ราคาขายปลีก
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                            ราคาขายส่ง
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {editSizeLabels.map((sizeLabel) => {
                          const price =
                            editForm.prices[sizeLabel] ?? emptyPrice;
                          return (
                            <tr key={sizeLabel}>
                              <td className="px-4 py-3 font-semibold text-slate-800">
                                {sizeLabel}
                              </td>
                              <td className="px-4 py-3">
                                <PriceInput
                                  value={price.cost}
                                  ariaLabel={`ราคาต้นทุนไซส์ ${sizeLabel}`}
                                  onChange={(value) =>
                                    updateEditPrice(sizeLabel, "cost", value)
                                  }
                                />
                              </td>
                              <td className="px-4 py-3">
                                <PriceInput
                                  value={price.retail}
                                  ariaLabel={`ราคาขายปลีกไซส์ ${sizeLabel}`}
                                  onChange={(value) =>
                                    updateEditPrice(sizeLabel, "retail", value)
                                  }
                                />
                              </td>
                              <td className="px-4 py-3">
                                <PriceInput
                                  value={price.wholesale}
                                  ariaLabel={`ราคาขายส่งไซส์ ${sizeLabel}`}
                                  onChange={(value) =>
                                    updateEditPrice(
                                      sizeLabel,
                                      "wholesale",
                                      value,
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <StepHeading
                  number={3}
                  title="รายการที่จะถูกอัปเดต"
                  description="ตรวจสอบชื่อเต็มหลังแก้ไขก่อนบันทึก"
                />
                <div className="max-h-56 overflow-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[720px] text-left">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {["SKU", "ชื่อสินค้าใหม่", "สี / ไซส์"].map(
                          (heading) => (
                            <th
                              key={heading}
                              className="border-b border-slate-200 px-4 py-3 text-[11px] font-semibold text-slate-500"
                            >
                              {heading}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editTarget.products.map((product) => {
                        const colorPart = product.color
                          ? ` สี${product.color}`
                          : "";
                        const sizePart = product.size
                          ? ` ไซส์ ${product.size}`
                          : "";
                        return (
                          <tr key={product.id}>
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-blue-700">
                              {product.sku}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-700">
                              {`${editForm.description.trim()}${colorPart}${sizePart}`}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600">
                              {product.color || "—"} / {product.size || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {editError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"
                >
                  {editError}
                </div>
              )}
                </TabsContent>

                {showBomTab ? (
                  <TabsContent value="bom" className="mt-0">
                    <BOMSetupPanel modelId={editModelId} />
                  </TabsContent>
                ) : null}
              </Tabs>
            </div>

            <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <p className="text-xs text-slate-500">
                จะอัปเดต{" "}
                <strong className="text-slate-800">
                  {editTarget.products.length}
                </strong>{" "}
                SKU พร้อมกัน
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeBatchEdit}
                  disabled={isEditSaving}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={requestBatchEditSave}
                  disabled={isEditSaving}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
                >
                  <Icon name="check" />
                  บันทึกการแก้ไข
                </button>
              </div>
            </footer>
          </div>

          {isEditConfirmOpen && (
            <div
              role="presentation"
              className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4"
              onMouseDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  !isEditSaving
                ) {
                  setIsEditConfirmOpen(false);
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-confirm-title"
                className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
              >
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3
                    id="edit-confirm-title"
                    className="text-sm font-bold text-slate-900"
                  >
                    ยืนยันการบันทึก
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    ยืนยันอัปเดตชื่อและราคาของทุก SKU ในรุ่นนี้ใช่หรือไม่?
                  </p>
                </div>
                <div className="px-5 py-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-800">
                      {editForm.description.trim()}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {editTarget.products.length.toLocaleString("th-TH")} SKU ·{" "}
                      {editSizeLabels.length.toLocaleString("th-TH")} ไซส์
                      {editForm.vendorId
                        ? ` · Vendor: ${
                            masterData.vendors.find(
                              (item) => item.id === editForm.vendorId,
                            )?.company_name ?? editForm.vendorId
                          }`
                        : " · ⚠ ยังไม่มี Vendor (บังคับ)"}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setIsEditConfirmOpen(false)}
                    disabled={isEditSaving}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmBatchEditSave()}
                    disabled={isEditSaving}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
                  >
                    {isEditSaving ? "กำลังบันทึก..." : "ยืนยันบันทึก"}
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
            );
          })()}
        </div>
      )}

      <SizeFormDialog
        open={isSizeMasterDialogOpen}
        onOpenChange={(open) => {
          setIsSizeMasterDialogOpen(open);
          if (!open) setEditingMasterSize(null);
        }}
        initialSize={
          editingMasterSize
            ? {
                id: editingMasterSize.id,
                brand_id: editingMasterSize.brand_id,
                size_label: editingMasterSize.size_label,
                size_code: editingMasterSize.size_code,
                sort_order: editingMasterSize.sort_order,
              }
            : null
        }
        brandId={null}
        onSuccess={(saved) => {
          void handleMasterSizeSaved(saved);
        }}
      />

      {isOverwriteModalOpen && existingDraftModel && pendingDraftPayload && (
        <div
          role="presentation"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeOverwriteModal();
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="overwrite-draft-title"
            aria-describedby="overwrite-draft-desc"
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <h3
                id="overwrite-draft-title"
                className="text-base font-bold text-slate-900"
              >
                พบรหัสรุ่นซ้ำในระบบ
              </h3>
              <p
                id="overwrite-draft-desc"
                className="mt-1 text-sm text-slate-600"
              >
                รหัสรุ่นนี้มีอยู่ในระบบแล้ว ต้องการบันทึกข้อมูลทับหรือไม่?
              </p>
              <p className="mt-2 font-mono text-xs font-semibold text-amber-700">
                model_code: {pendingDraftPayload.modelCode.trim().toUpperCase()}
              </p>
            </header>

            <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2 sm:px-6">
              <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Existing Data
                </h4>
                <dl className="mt-3 space-y-2.5 text-xs">
                  <div>
                    <dt className="text-slate-400">name</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {existingDraftModel.name || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">short_name</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {existingDraftModel.short_name || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">tax_type</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-slate-800">
                      {existingDraftModel.tax_type || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">gender / status</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {existingDraftModel.gender || "—"} ·{" "}
                      {existingDraftModel.status || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">size_pricing_config</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-700">
                      {formatSizePricingSummary(
                        existingDraftModel.size_pricing_config,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wide text-blue-600">
                  New Data
                </h4>
                <dl className="mt-3 space-y-2.5 text-xs">
                  <div>
                    <dt className="text-blue-400">name</dt>
                    <dd
                      className={`mt-0.5 font-medium ${
                        pendingDraftPayload.name !== existingDraftModel.name
                          ? "text-blue-900 underline decoration-blue-300"
                          : "text-slate-800"
                      }`}
                    >
                      {pendingDraftPayload.name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-blue-400">short_name</dt>
                    <dd
                      className={`mt-0.5 font-medium ${
                        (pendingDraftPayload.shortName ?? "") !==
                        (existingDraftModel.short_name ?? "")
                          ? "text-blue-900 underline decoration-blue-300"
                          : "text-slate-800"
                      }`}
                    >
                      {pendingDraftPayload.shortName || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-blue-400">tax_type</dt>
                    <dd
                      className={`mt-0.5 font-mono font-semibold ${
                        pendingDraftPayload.taxType !==
                        existingDraftModel.tax_type
                          ? "text-blue-900 underline decoration-blue-300"
                          : "text-slate-800"
                      }`}
                    >
                      {pendingDraftPayload.taxType}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-blue-400">gender / status</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {pendingDraftPayload.gender} · DRAFT
                    </dd>
                  </div>
                  <div>
                    <dt className="text-blue-400">size_pricing_config</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-700">
                      {formatSizePricingSummary(
                        pendingDraftPayload.sizePricingConfig,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={closeOverwriteModal}
                disabled={isDraftSaving}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmOverwriteDraft()}
                disabled={isDraftSaving}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
              >
                {isDraftSaving ? "กำลังบันทึกทับ..." : "Confirm Overwrite"}
              </button>
            </footer>
          </div>
        </div>
      )}

      <ProductModelPreviewSheet />

      {entitySheet && (
        <div
          role="presentation"
          className="fixed inset-0 z-[70] flex justify-end bg-slate-950/40 backdrop-blur-[1px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEntitySheet(null);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="entity-sheet-title"
            className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                  {entitySheet.kind === "vendor" ? "Vendor" : "Brand"}
                </p>
                <h3
                  id="entity-sheet-title"
                  className="mt-1 text-base font-bold text-slate-900"
                >
                  {entitySheet.kind === "vendor"
                    ? entitySheet.data.company_name
                    : entitySheet.data.brand_name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEntitySheet(null)}
                aria-label="ปิดรายละเอียด"
                className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <Icon name="close" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {entitySheet.kind === "vendor" ? (
                <>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold text-slate-400">
                      ประเภท
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      ผู้จำหน่าย (Vendor)
                    </p>
                  </div>
                  <div className="grid gap-3">
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">
                        ชื่อเต็ม
                      </p>
                      <p className="mt-1 text-sm text-slate-800">
                        {entitySheet.data.company_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">
                        เบอร์ติดต่อ
                      </p>
                      <p className="mt-1 text-sm text-slate-800">
                        {entitySheet.data.phone || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">
                        เลขผู้เสียภาษี
                      </p>
                      <p className="mt-1 text-sm text-slate-800">
                        {entitySheet.data.tax_id || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">
                        สาขา
                      </p>
                      <p className="mt-1 text-sm text-slate-800">
                        {entitySheet.data.branch_code || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">
                        ที่อยู่
                      </p>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-slate-800">
                        {entitySheet.data.address || "—"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-400">
                          ระดับราคา
                        </p>
                        <p className="mt-1 text-sm text-slate-800">
                          {entitySheet.data.default_price_tier || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-slate-400">
                          เครดิต (วัน)
                        </p>
                        <p className="mt-1 text-sm text-slate-800">
                          {entitySheet.data.credit_days ?? "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold text-slate-400">
                      ประเภท
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      แบรนด์ (mst_brands)
                    </p>
                  </div>
                  <div className="grid gap-3">
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">
                        ชื่อแบรนด์
                      </p>
                      <p className="mt-1 text-sm text-slate-800">
                        {entitySheet.data.brand_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">
                        รหัสแบรนด์ (SKU prefix)
                      </p>
                      <p className="mt-1 font-mono text-sm font-semibold tracking-wide text-blue-700">
                        {entitySheet.data.brand_code}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
