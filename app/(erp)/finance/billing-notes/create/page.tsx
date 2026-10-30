import type { Metadata } from "next";
import {
  getOutstandingContactsSummary,
  getUnbilledApVendorQueue,
  getUnbilledInvoices,
} from "@/app/actions/billing";
import type {
  BillingCategory,
  OutstandingContactSummary,
  UnbilledApVendorQueueItem,
  UnbilledInvoice,
} from "@/types/billing";
import { CreateBillingNoteScreen } from "@/components/finance/create-billing-note-screen";
import { listActiveCustomers } from "@/lib/actions/document-actions";
import { getActiveVendors } from "@/lib/actions/mapping";
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
    mode?: string;
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
  let creditDays = 0;
  let outstandingContacts: OutstandingContactSummary[] = [];
  let outstandingError: string | null = null;
  let vendorQueue: UnbilledApVendorQueueItem[] = [];
  let vendorQueueError: string | null = null;

  if (type === "AP") {
    const queue = await getUnbilledApVendorQueue();
    vendorQueue = queue.data;
    vendorQueueError = queue.error;
  }

  if (contactId) {
    const result = await getUnbilledInvoices(contactId, type);
    invoices = result.data;
    invoicesError = result.error;
    creditDays = result.creditDays;
  } else {
    const result = await getOutstandingContactsSummary(type);
    outstandingContacts = result.data;
    outstandingError = result.error;
  }

  const listHref = `/finance/billing-notes?type=${type === "AP" ? "BR" : "BN"}`;
  const pickerHref = `/finance/billing-notes/create?type=${type}`;
  const batchHref = "/finance/billing-notes/create?type=AP&mode=batch";

  const mode = params.mode === "batch" && type === "AP" ? "batch" : "single";

  return (
    <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
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

      <CreateBillingNoteScreen
        type={type}
        contactId={contactId}
        mode={mode}
        customers={customers}
        vendors={vendors}
        invoices={invoices}
        outstandingContacts={outstandingContacts}
        creditDays={creditDays}
        vendorQueue={vendorQueue}
        vendorQueueError={vendorQueueError}
        listHref={listHref}
        pickerHref={pickerHref}
        batchHref={batchHref}
      />
    </div>
  );
}
