"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getContactVendorTaxTierAction,
  setContactVendorTaxTierAction,
  uploadContactIdCardAction,
} from "@/app/actions/finance/cash-receipts";
import type { VendorTaxTier } from "@/types/cash-receipt";

const OPTIONS: { value: VendorTaxTier; label: string }[] = [
  { value: "CORP_VAT", label: "🏢 1.1 นิติบุคคล (มีใบกำกับภาษี VAT)" },
  { value: "INDIVIDUAL_ID_1_2", label: "🪪 1.2 บุคคลธรรมดา แนบบัตรประชาชน (ออกใบรับเงินส่งบัญชี)" },
  { value: "INTERNAL_NO_ID_1_3", label: "🔒 1.3 บุคคลธรรมดา ไม่แนบบัตรประชาชน (บิลภายใน)" },
];

export function VendorTaxTierCard({ contactId }: { contactId: string }) {
  const [tier, setTier] = useState<VendorTaxTier>("CORP_VAT");
  const [idCardUrl, setIdCardUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getContactVendorTaxTierAction(contactId).then((result) => {
      if (cancelled || result.error) return;
      if (result.vendorTaxTier) setTier(result.vendorTaxTier);
      setIdCardUrl(result.idCardAttachmentUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  async function saveTier(next: VendorTaxTier) {
    setTier(next);
    setSaving(true);
    try {
      const result = await setContactVendorTaxTierAction({ contactId, vendorTaxTier: next });
      if (!result.success) {
        toast.error(result.error ?? "บันทึกประเภทผู้จำหน่ายไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกประเภทผู้จำหน่ายแล้ว");
    } finally {
      setSaving(false);
    }
  }

  async function uploadCard(file: File | null) {
    if (!file) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set("contact_id", contactId);
      formData.set("id_card", file);
      const result = await uploadContactIdCardAction(formData);
      if (!result.success || !result.url) {
        toast.error(result.error ?? "อัปโหลดสำเนาบัตรไม่สำเร็จ");
        return;
      }
      setTier("INDIVIDUAL_ID_1_2");
      setIdCardUrl(result.url);
      toast.success("อัปโหลดสำเนาบัตรประชาชนแล้ว");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">ประเภทผู้จำหน่ายสำหรับบัญชี</p>
      <div className="mt-3 space-y-2">
        {OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="radio"
              name={`vendor-tax-tier-${contactId}`}
              checked={tier === option.value}
              disabled={saving}
              onChange={() => void saveTier(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {tier === "INDIVIDUAL_ID_1_2" ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-slate-600">
            สำเนาบัตรประชาชน
            <input
              type="file"
              accept="image/*,application/pdf,.pdf"
              disabled={saving}
              className="mt-1 block w-full text-xs"
              onChange={(event) => void uploadCard(event.target.files?.[0] ?? null)}
            />
          </label>
          {idCardUrl ? (
            <a href={idCardUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-700 underline">
              เปิดสำเนาบัตรที่บันทึกไว้
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
