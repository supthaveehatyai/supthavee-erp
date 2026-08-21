import type { Metadata } from "next";
import { HandCoins } from "lucide-react";
import { DepositCreateForm } from "./deposit-create-form";
import type { DepositTab } from "@/types/deposit";
import { listActiveCustomers } from "@/lib/actions/document-actions";
import { getActiveVendors } from "@/lib/actions/mapping";
import { todayIsoDate } from "@/lib/utils/outstanding-summary";

export const metadata: Metadata = {
  title: "สร้างเอกสารมัดจำ | Deposit",
  description: "ฟอร์มรับ/จ่ายเงินมัดจำ (DEP_IN / DEP_OUT)",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    type?: string;
  }>;
};

function resolveDocType(raw: string | undefined): DepositTab {
  return raw === "DEP_OUT" ? "DEP_OUT" : "DEP_IN";
}

export default async function CreateDepositPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const docType = resolveDocType(params.type);

  const [customersResult, vendorsResult] = await Promise.all([
    listActiveCustomers(),
    getActiveVendors(),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <HandCoins className="h-8 w-8 text-blue-600" />
          สร้างเอกสารเงินมัดจำ
        </h1>
        <p className="text-slate-500">
          ประเภทเอกสารควบคุมผ่าน URL{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            ?type=DEP_IN|DEP_OUT
          </code>
        </p>
      </div>

      {(customersResult.error || vendorsResult.error) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {customersResult.error
            ? `โหลดลูกค้าไม่สำเร็จ: ${customersResult.error}`
            : null}
          {customersResult.error && vendorsResult.error ? " · " : null}
          {vendorsResult.error
            ? `โหลดซัพพลายเออร์ไม่สำเร็จ: ${vendorsResult.error}`
            : null}
        </div>
      )}

      <DepositCreateForm
        key={docType}
        docType={docType}
        customers={customersResult.data ?? []}
        vendors={vendorsResult.data ?? []}
        defaultDate={todayIsoDate()}
      />
    </div>
  );
}
