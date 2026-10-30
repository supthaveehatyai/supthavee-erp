import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileSpreadsheet, List, Zap } from "lucide-react";
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
import { CreateBillingNoteForm } from "@/components/finance/CreateBillingNoteForm";
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="sticky top-16 z-20 -mx-6 flex flex-col gap-3 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={listHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="size-4" />
            {type === "AP" ? "กลับหน้ารายการรับวางบิล (BR)" : "กลับหน้ารายการวางบิล (BN)"}
          </Link>
          {type === "AP" ? (
            <>
              <Link
                href={pickerHref}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <List className="size-4" />
                ดูรายชื่อเจ้าหนี้ค้างวางบิลทั้งหมด
              </Link>
              <Link
                href={batchHref}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-900 transition hover:bg-orange-100"
              >
                <Zap className="size-4" />
                โหมดรวบวางบิลหลายเจ้าพร้อมกัน (Batch BR)
              </Link>
            </>
          ) : (
            <Link
              href={pickerHref}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <List className="size-4" />
              ดูรายชื่อลูกค้าค้างวางบิลทั้งหมด
            </Link>
          )}
        </div>
        {type === "AP" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-slate-800">
              คิวรอวางบิล (เหลือ {vendorQueue.length} เจ้า)
            </p>
            {vendorQueueError ? (
              <p className="text-xs text-amber-700">โหลดคิวไม่สำเร็จ: {vendorQueueError}</p>
            ) : null}
            {vendorQueue.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {vendorQueue.map((vendor) => {
                  const active = vendor.contact_id === contactId;
                  return (
                    <Link
                      key={vendor.contact_id}
                      href={`/finance/billing-notes/create?type=AP&contact_id=${encodeURIComponent(vendor.contact_id)}`}
                      title={vendor.contact_name}
                      className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-semibold transition ${
                        active
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                      }`}
                    >
                      {vendor.contact_name} ({vendor.unbilled_count ?? vendor.invoice_count ?? 0} ใบ)
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500">ไม่มีเจ้าหนี้ที่ยังค้างวางบิล</p>
            )}
          </div>
        ) : null}
      </div>
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
        creditDays={creditDays}
        mode={params.mode === "batch" && type === "AP" ? "batch" : "single"}
      />
    </div>
  );
}
