"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { convertPurchaseBillTaxModeAction } from "@/app/actions/finance/cash-receipts";
import type { AccountingTaxTier } from "@/types/cash-receipt";

const OPTIONS: { tier: AccountingTaxTier; label: string }[] = [
  { tier: "CORP_VAT", label: "VAT" },
  { tier: "RECEIPT_1_2", label: "1.2 ใบรับเงิน" },
  { tier: "INTERNAL_1_3", label: "1.3 บิลภายใน" },
];

export function AccountingTaxTierBadge({ tier }: { tier?: string | null }) {
  if (tier === "CORP_VAT") {
    return (
      <span className="mt-1 inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 ring-1 ring-blue-200">
        [VAT 7%]
      </span>
    );
  }
  if (tier === "RECEIPT_1_2") {
    return (
      <span className="mt-1 inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
        [1.2 ใบรับเงินบัตร ปชช.]
      </span>
    );
  }
  if (tier === "INTERNAL_1_3") {
    return (
      <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-300">
        [1.3 บิลภายใน noVAT]
      </span>
    );
  }
  return null;
}

export function PurchaseTaxTierSwitch({
  documentId,
  current,
}: {
  documentId: string;
  current?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tier, setTier] = useState(current ?? "");

  useEffect(() => {
    setTier(current ?? "");
  }, [current]);

  function convert(target: AccountingTaxTier) {
    if (!documentId || target === tier) return;
    startTransition(async () => {
      const result = await convertPurchaseBillTaxModeAction(documentId, target);
      if (!result.success) {
        toast.error(result.error ?? "สลับประเภทบิลไม่สำเร็จ");
        return;
      }
      setTier(target);
      toast.success(
        result.grandTotal == null
          ? "สลับประเภทบิลแล้ว"
          : `สลับประเภทบิลแล้ว ยอดใหม่ ฿${result.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="mt-1 flex flex-col items-start gap-1">
      <AccountingTaxTierBadge tier={tier} />
      <div className="flex flex-wrap gap-1">
        {OPTIONS.map((option) => (
          <button
            key={option.tier}
            type="button"
            disabled={pending}
            onClick={() => convert(option.tier)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${
              tier === option.tier
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
