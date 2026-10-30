"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileSpreadsheet, List, Zap } from "lucide-react";
import { CreateBillingNoteForm } from "@/components/finance/CreateBillingNoteForm";
import { ContactSortBar } from "@/components/finance/billing-sort-controls";
import type { CustomerOption } from "@/types/document";
import type { VendorOption } from "@/lib/actions/mapping";
import type {
  BillingCategory,
  OutstandingContactSummary,
  UnbilledApVendorQueueItem,
  UnbilledInvoice,
} from "@/types/billing";
import {
  matchesContactQuery,
  sortContacts,
  type ContactSortKey,
  type SortDir,
} from "@/lib/utils/billing-list-sort";

export function CreateBillingNoteScreen({
  type,
  contactId,
  mode,
  customers,
  vendors,
  invoices,
  outstandingContacts,
  creditDays,
  vendorQueue,
  vendorQueueError,
  listHref,
  pickerHref,
  batchHref,
}: {
  type: BillingCategory;
  contactId: string;
  mode: "single" | "batch";
  customers: CustomerOption[];
  vendors: VendorOption[];
  invoices: UnbilledInvoice[];
  outstandingContacts: OutstandingContactSummary[];
  creditDays: number;
  vendorQueue: UnbilledApVendorQueueItem[];
  vendorQueueError: string | null;
  listHref: string;
  pickerHref: string;
  batchHref: string;
}) {
  const [contactQuery, setContactQuery] = useState("");
  const [contactSort, setContactSort] = useState<ContactSortKey>("amount");
  const [contactDir, setContactDir] = useState<SortDir>("desc");
  const browsingContacts = mode === "batch" || !contactId;
  const queueContacts = useMemo(() => {
    const filtered = vendorQueue.filter((vendor) =>
      matchesContactQuery(vendor.contact_name, contactQuery),
    );
    return sortContacts(filtered, contactSort, contactDir, {
      name: (vendor) => vendor.contact_name,
      count: (vendor) => vendor.unbilled_count ?? vendor.invoice_count ?? 0,
      amount: (vendor) => vendor.total_outstanding,
    });
  }, [vendorQueue, contactQuery, contactSort, contactDir]);

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-16 z-20 -mx-6 overflow-visible border-b border-slate-200 bg-white px-6 py-4">
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
        <div className="mt-4 flex flex-col gap-1">
          <h1 className="flex items-center gap-2 py-1 text-3xl font-bold leading-normal tracking-tight text-slate-900">
            <FileSpreadsheet className="h-8 w-8 shrink-0 text-blue-600" />
            สร้างใบวางบิล
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            เลือกคู่ค้าที่มียอดค้าง ติ๊กบิลที่ต้องการวางบิล แล้วกดบันทึก เลขที่เอกสารจะอิงวันที่หัวใบวางบิล
          </p>
        </div>
        {type === "AP" && !browsingContacts ? (
          <div className="mt-3">
            <ContactSortBar
              query={contactQuery}
              onQueryChange={setContactQuery}
              sortKey={contactSort}
              sortDir={contactDir}
              onSort={(key, dir) => {
                setContactSort(key);
                setContactDir(dir);
              }}
            />
          </div>
        ) : null}
        {type === "AP" ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm font-semibold text-slate-800">
              คิวรอวางบิล (เหลือ {queueContacts.length} เจ้า)
            </p>
            {vendorQueueError ? (
              <p className="text-xs text-amber-700">โหลดคิวไม่สำเร็จ: {vendorQueueError}</p>
            ) : null}
            {queueContacts.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {queueContacts.map((vendor) => {
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
              <p className="text-xs text-slate-500">
                {contactQuery.trim() ? "ไม่พบคู่ค้าที่ตรงกับคำค้น" : "ไม่มีเจ้าหนี้ที่ยังค้างวางบิล"}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <CreateBillingNoteForm
        key={`${type}-${contactId}-${mode}`}
        type={type}
        contactId={contactId}
        customers={customers}
        vendors={vendors}
        invoices={invoices}
        outstandingContacts={outstandingContacts}
        creditDays={creditDays}
        mode={mode}
        contactQuery={contactQuery}
        contactSort={contactSort}
        contactDir={contactDir}
        onContactQueryChange={setContactQuery}
        onContactSort={(key, dir) => {
          setContactSort(key);
          setContactDir(dir);
        }}
      />
    </div>
  );
}
