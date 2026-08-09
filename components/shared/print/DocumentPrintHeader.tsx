import { getSystemSettings } from "@/lib/actions/settings";
import type { DocumentPrintHeaderProps } from "@/types/print-document";

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTaxId(taxId: string | null | undefined): string {
  const digits = (taxId ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return taxId?.trim() || "";
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

/** Flatten multi-line address into a single print line. */
function flattenAddress(address: string | null | undefined): string {
  return (address ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Line 1 — Name + branch:
 * `บริษัท … จำกัด (สาขา: 00000 สำนักงานใหญ่)`
 */
function formatPartyNameLine(
  name: string,
  branchCode?: string | null,
  branchName?: string | null,
): string {
  const code = branchCode?.trim() || "";
  const branch = branchName?.trim() || "";
  const branchPart = [code, branch].filter(Boolean).join(" ");
  if (!branchPart) return name;
  return `${name} (สาขา: ${branchPart})`;
}

/**
 * Line 3 — Tax / Phone / Email — only include segments that have values.
 * Separator: ` | `
 */
function formatContactMetaLine(parts: {
  taxId?: string;
  phone?: string;
  email?: string;
}): string | null {
  const segments: string[] = [];
  if (parts.taxId) {
    segments.push(`เลขประจำตัวผู้เสียภาษี: ${parts.taxId}`);
  }
  if (parts.phone) {
    segments.push(`โทร: ${parts.phone}`);
  }
  if (parts.email) {
    segments.push(`อีเมล: ${parts.email}`);
  }
  return segments.length > 0 ? segments.join(" | ") : null;
}

/**
 * Compact print header (TFRS) — ดึงบริษัทจาก system_settings ผ่าน Server Action.
 * Top row: flex-row ตายตัว 65% / 35% (ไม่ใช้ sm: breakpoint — A4/A5 เหมือนกัน)
 * Party block = 3 บรรทัด (ชื่อ+สาขา / ที่อยู่ / Tax|โทร|อีเมล)
 */
export async function DocumentPrintHeader({
  title,
  documentNo,
  date,
  customerData,
  dueDate,
  partyLabel = "ลูกค้า / Customer",
  status,
  referenceNo,
}: DocumentPrintHeaderProps) {
  const settingsResult = await getSystemSettings();
  const company = settingsResult.success ? settingsResult.data : null;

  const companyName =
    company?.company_name?.trim() || "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด";
  const branchCode = company?.branch_code?.trim() || "00000";
  const branchName = company?.branch_name?.trim() || "สำนักงานใหญ่";
  const companyAddress = flattenAddress(company?.address);
  const companyPhone = company?.phone?.trim() || "";
  const companyEmail = company?.email?.trim() || "";
  const companyTaxId = formatTaxId(company?.tax_id);
  const logoUrl = company?.logo_url?.trim().split("?")[0] || "";

  const companyNameLine = formatPartyNameLine(
    companyName,
    branchCode,
    branchName,
  );
  const companyMetaLine = formatContactMetaLine({
    taxId: companyTaxId || undefined,
    phone: companyPhone || undefined,
    email: companyEmail || undefined,
  });

  const customerName = customerData?.company_name?.trim() || "—";
  const customerNameLine = formatPartyNameLine(
    customerName,
    customerData?.branch_code,
    customerData?.branch_name,
  );
  const customerAddress = flattenAddress(customerData?.address);
  const customerPhone = customerData?.phone?.trim() || "";
  const customerEmail = customerData?.email?.trim() || "";
  const customerTaxId = formatTaxId(customerData?.tax_id);
  const customerMetaLine = formatContactMetaLine({
    taxId: customerTaxId || undefined,
    phone: customerPhone || undefined,
    email: customerEmail || undefined,
  });

  return (
    <header className="border-b border-neutral-400 pb-3">
      {/* บังคับซ้าย-ขวาตายตัว — ไม่ใช้ responsive breakpoint (A4 / A5 เหมือนกัน) */}
      <div className="flex w-full flex-row flex-nowrap items-start justify-between gap-3">
        {/* ซ้าย: บริษัทเรา (จาก system_settings) — 3 บรรทัด */}
        <div className="flex w-[65%] min-w-0 flex-row flex-nowrap items-start gap-2.5">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-300 bg-neutral-50">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={companyName}
                className="max-h-full max-w-full object-contain p-0.5"
                suppressHydrationWarning={true}
              />
            ) : (
              <span className="text-sm font-black tracking-tight text-neutral-800">
                ST
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden text-[10.5px] leading-snug text-neutral-800">
            <p className="truncate text-[12px] font-bold tracking-tight text-neutral-950">
              {companyNameLine}
            </p>
            {companyAddress ? (
              <p className="mt-0.5 whitespace-normal break-words text-neutral-700">
                {companyAddress}
              </p>
            ) : null}
            {companyMetaLine ? (
              <p className="mt-0.5 whitespace-normal break-words text-neutral-700">
                {companyMetaLine}
              </p>
            ) : null}
          </div>
        </div>

        {/* ขวา: ประเภทเอกสาร + เลขที่ */}
        <div className="w-[35%] shrink-0 text-right text-[10.5px] leading-snug">
          <p className="whitespace-normal break-words text-base font-bold text-neutral-950">
            {title}
          </p>
          <p className="mt-0.5 truncate font-mono text-sm font-semibold text-neutral-900">
            เลขที่ {documentNo}
          </p>
          <p className="mt-0.5 whitespace-nowrap text-neutral-700">
            วันที่เอกสาร: {formatDisplayDate(date)}
          </p>
          {dueDate ? (
            <p className="whitespace-nowrap text-neutral-700">
              วันครบกำหนด: {formatDisplayDate(dueDate)}
            </p>
          ) : null}
          {status ? (
            <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              สถานะ: {status}
            </p>
          ) : null}
          {referenceNo?.trim() ? (
            <p className="truncate text-neutral-600">
              อ้างอิง: {referenceNo.trim()}
            </p>
          ) : null}
        </div>
      </div>

      {/* ลูกค้า / คู่ค้า — 3 บรรทัดเดียวกัน */}
      <div className="mt-2.5 border-t border-neutral-200 pt-2.5">
        <p className="text-[9.5px] font-semibold uppercase tracking-wide text-neutral-500">
          {partyLabel}
        </p>
        <div className="mt-0.5 min-w-0 text-[10.5px] leading-snug text-neutral-800">
          <p className="truncate text-[12px] font-semibold text-neutral-900">
            {customerNameLine}
          </p>
          {customerAddress ? (
            <p className="mt-0.5 whitespace-normal break-words text-neutral-700">
              {customerAddress}
            </p>
          ) : null}
          {customerMetaLine ? (
            <p className="mt-0.5 whitespace-normal break-words text-neutral-700">
              {customerMetaLine}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}
