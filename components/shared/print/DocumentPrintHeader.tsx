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
  if (digits.length !== 13) return taxId?.trim() || "—";
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

/**
 * A4 print header — ดึงข้อมูลบริษัทจาก system_settings (SSOT) ผ่าน Server Action.
 * Layout 2 คอลัมน์: ซ้าย = บริษัทเรา, ขวา = ลูกค้า + เลขที่เอกสาร
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
  const companyNameEn = company?.company_name_en?.trim() || "";
  const branchCode = company?.branch_code?.trim() || "00000";
  const branchName = company?.branch_name?.trim() || "สำนักงานใหญ่";
  const companyAddress = company?.address?.trim() || "";
  const companyPhone = company?.phone?.trim() || "";
  const companyTaxId = company?.tax_id?.trim() || "";
  const logoUrl = company?.logo_url?.trim().split("?")[0] || "";

  const customerName = customerData?.company_name?.trim() || "—";
  const customerTaxId = customerData?.tax_id?.trim() || "";
  const customerBranch = [
    customerData?.branch_code?.trim(),
    customerData?.branch_name?.trim(),
  ]
    .filter(Boolean)
    .join(" · ");
  const customerAddress = customerData?.address?.trim() || "";
  const customerPhone = customerData?.phone?.trim() || "";

  return (
    <header className="border-b border-neutral-400 pb-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* ซ้าย: บริษัทเรา (จาก system_settings) */}
        <div className="flex items-start gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-300 bg-neutral-50">
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
          <div className="min-w-0 text-[11px] leading-relaxed text-neutral-800">
            <h1 className="text-sm font-bold tracking-tight text-neutral-950">
              {companyName}
            </h1>
            {companyNameEn ? (
              <p className="text-[10px] text-neutral-600">{companyNameEn}</p>
            ) : null}
            <p className="mt-1">
              สาขา: {branchCode} {branchName}
            </p>
            {companyAddress ? (
              <p className="mt-0.5 whitespace-pre-wrap">{companyAddress}</p>
            ) : null}
            {companyPhone ? <p>โทร: {companyPhone}</p> : null}
            <p className="mt-0.5 font-medium">
              เลขประจำตัวผู้เสียภาษี: {formatTaxId(companyTaxId)}
            </p>
          </div>
        </div>

        {/* ขวา: ประเภทเอกสาร + ลูกค้า */}
        <div className="text-[11px] leading-relaxed sm:text-right">
          <p className="text-base font-bold text-neutral-950">{title}</p>
          <p className="mt-1 font-mono text-sm font-semibold text-neutral-900">
            เลขที่ {documentNo}
          </p>
          <p className="mt-1 text-neutral-700">
            วันที่เอกสาร: {formatDisplayDate(date)}
          </p>
          {dueDate ? (
            <p className="text-neutral-700">
              วันครบกำหนด: {formatDisplayDate(dueDate)}
            </p>
          ) : null}
          {status ? (
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              สถานะ: {status}
            </p>
          ) : null}
          {referenceNo?.trim() ? (
            <p className="text-neutral-600">อ้างอิง: {referenceNo.trim()}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-2">
        <div className="text-[11px] leading-relaxed">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {partyLabel}
          </p>
          <p className="mt-1 text-sm font-semibold text-neutral-900">
            {customerName}
          </p>
          {customerTaxId ? (
            <p className="mt-0.5">
              เลขผู้เสียภาษี: {formatTaxId(customerTaxId)}
            </p>
          ) : null}
          {customerBranch ? <p>สาขา: {customerBranch}</p> : null}
          {customerAddress ? (
            <p className="mt-0.5 whitespace-pre-wrap text-neutral-700">
              {customerAddress}
            </p>
          ) : null}
          {customerPhone ? (
            <p className="text-neutral-700">โทร: {customerPhone}</p>
          ) : null}
        </div>
        <div className="hidden sm:block" aria-hidden="true" />
      </div>
    </header>
  );
}
