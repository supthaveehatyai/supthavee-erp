import type { PrintCompanyProfile } from "@/types/print-document";

function formatTaxId(taxId: string | null | undefined): string {
  const digits = (taxId ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return taxId?.trim() || "";
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

function partyNameLine(
  name: string,
  branchCode?: string | null,
  branchName?: string | null,
): string {
  const branch = branchName?.trim() || branchCode?.trim() || "";
  if (!branch) return name;
  return `${name} (สาขา: ${branch})`;
}

export function GoodsReceiptSheetHeader({
  company,
  title,
  subtitle,
  partyLabel,
  partyName,
  partyBranchCode,
  partyBranchName,
  partyAddress,
  partyTaxId,
  partyPhone,
  documentNo,
  dateLabel,
  referenceNo,
  docType,
  status,
}: {
  company: PrintCompanyProfile;
  title: string;
  subtitle: string;
  partyLabel: string;
  partyName: string;
  partyBranchCode?: string | null;
  partyBranchName?: string | null;
  partyAddress?: string | null;
  partyTaxId?: string | null;
  partyPhone?: string | null;
  documentNo: string;
  dateLabel: string;
  referenceNo?: string | null;
  docType?: string | null;
  status?: string | null;
}) {
  const companyLine = `${company.companyName} ${company.branchName} สาขา: ${company.branchCode}`;
  const taxId = formatTaxId(company.taxId);
  const companyMeta = [
    taxId ? `เลขประจำตัวผู้เสียภาษี: ${taxId}` : "",
    company.phone ? `โทร: ${company.phone}` : "",
    company.email ? `อีเมล: ${company.email}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const vendorTax = formatTaxId(partyTaxId);
  const vendorMeta = [
    vendorTax ? `เลขประจำตัวผู้เสียภาษี: ${vendorTax}` : "",
    partyPhone?.trim() ? `โทร: ${partyPhone.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    <header className="goods-receipt-sheet-header text-neutral-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-300 bg-neutral-50">
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logoUrl}
                alt={company.companyName}
                className="max-h-full max-w-full object-contain p-0.5"
              />
            ) : (
              <span className="text-xs font-black tracking-tight text-neutral-800">ST</span>
            )}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="text-[12px] font-bold text-neutral-950">{companyLine}</p>
            <p className="text-[10px] text-neutral-600">({company.companyNameEn})</p>
            <p className="mt-0.5 text-[10px] text-neutral-700">{company.address}</p>
            {companyMeta ? (
              <p className="text-[10px] text-neutral-700">{companyMeta}</p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[13px] font-bold leading-tight text-neutral-950">{title}</p>
          <p className="text-[11px] font-semibold tracking-wide whitespace-nowrap text-slate-600">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[3fr_2fr] border-t border-neutral-300 pt-1.5">
        <div className="min-w-0 pr-3 leading-tight">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
            {partyLabel}
          </p>
          <p className="text-[12px] font-bold text-neutral-950">
            {partyNameLine(partyName, partyBranchCode, partyBranchName)}
          </p>
          {partyAddress?.trim() ? (
            <p className="text-[10px] text-neutral-700">{partyAddress.trim()}</p>
          ) : null}
          {vendorMeta ? <p className="text-[10px] text-neutral-700">{vendorMeta}</p> : null}
        </div>
        <div className="space-y-0.5 border-l border-neutral-300 pl-3 text-right text-[10px] leading-tight">
          <p>
            <span className="text-neutral-500">เลขที่เอกสาร: </span>
            <span className="font-mono text-[12px] font-bold text-neutral-950">{documentNo}</span>
          </p>
          <p>
            <span className="text-neutral-500">วันที่เอกสาร: </span>
            <span className="font-medium">{dateLabel}</span>
          </p>
          <p>
            <span className="text-neutral-500">เลขที่บิลผู้จำหน่ายอ้างอิง (Ref No.): </span>
            <span className="font-mono font-semibold">{referenceNo?.trim() || "—"}</span>
          </p>
          <p className="font-semibold">
            ประเภทเอกสาร: {docType?.trim() || "—"}
            <span className="mx-1 font-normal text-neutral-400">|</span>
            สถานะ: {status?.trim() || "—"}
          </p>
        </div>
      </div>
    </header>
  );
}
