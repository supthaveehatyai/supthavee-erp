import type { Metadata } from "next";
import { FileSpreadsheet } from "lucide-react";
import {
  getOutstandingContactsSummary,
  getUnbilledInvoices,
} from "@/app/actions/billing";
import type {
  BillingCategory,
  OutstandingContactSummary,
  UnbilledInvoice,
} from "@/types/billing";
import { CreateBillingNoteForm } from "@/components/finance/CreateBillingNoteForm";
import { listActiveCustomers } from "@/lib/actions/document-actions";
import { getActiveVendors } from "@/lib/actions/mapping";
import { todayIsoDate } from "@/lib/utils/outstanding-summary";
import type { CustomerOption } from "@/types/document";
import type { VendorOption } from "@/lib/actions/mapping";

export const metadata: Metadata = {
  title: "สร้างใบวางบิล | Billing Note",
  description: "สร้างใบวางบิลลูกหนี้ (BN) / รับวางบิลเจ้าหนี้ (BR)",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    type?: string;
    contact_id?: string;
  }>;
};

function resolveType(raw: string | undefined): BillingCategory {
  return raw === "AP" ? "AP" : "AR";
}

export default async function CreateBillingNotePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const type = resolveType(params.type);
  const contactId = params.contact_id?.trim() || "";

  const [customersResult, vendorsResult] = await Promise.all([
    listActiveCustomers(),
    getActiveVendors(),
  ]);

  const customers: CustomerOption[] = customersResult.data ?? [];
  const vendors: VendorOption[] = vendorsResult.data ?? [];

  let invoices: UnbilledInvoice[] = [];
  let invoicesError: string | null = null;
  let outstandingContacts: OutstandingContactSummary[] = [];
  let outstandingError: string | null = null;

  if (contactId) {
    const result = await getUnbilledInvoices(contactId, type);
    invoices = result.data;
    invoicesError = result.error;
  } else {
    const result = await getOutstandingContactsSummary(type);
    outstandingContacts = result.data;
    outstandingError = result.error;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <FileSpreadsheet className="h-8 w-8 text-blue-600" />
          สร้างใบวางบิล
        </h1>
        <p className="text-slate-500">
          สถานะฟอร์มควบคุมผ่าน URL{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            ?type=AR|AP&amp;contact_id=
          </code>
        </p>
      </div>

      {(customersResult.error ||
        vendorsResult.error ||
        invoicesError ||
        outstandingError) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {[
            customersResult.error
              ? `โหลดลูกค้าไม่สำเร็จ: ${customersResult.error}`
              : null,
            vendorsResult.error
              ? `โหลดซัพพลายเออร์ไม่สำเร็จ: ${vendorsResult.error}`
              : null,
            invoicesError
              ? `โหลดบิลค้างวางบิลไม่สำเร็จ: ${invoicesError}`
              : null,
            outstandingError
              ? `โหลดสรุปยอดค้างไม่สำเร็จ: ${outstandingError}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}

      <CreateBillingNoteForm
        key={`${type}-${contactId}`}
        type={type}
        contactId={contactId}
        customers={customers}
        vendors={vendors}
        invoices={invoices}
        outstandingContacts={outstandingContacts}
        defaultDate={todayIsoDate()}
      />
    </div>
  );
}
