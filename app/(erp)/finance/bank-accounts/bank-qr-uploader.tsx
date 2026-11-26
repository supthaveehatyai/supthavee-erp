"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  clearSupthaveeBankQrAction,
  updateSupthaveeBankQrSettingsAction,
  uploadSupthaveeBankQrAction,
} from "@/lib/actions/bank-accounts";
import { compressImage } from "@/lib/utils/image-compression";
import { isPlatformClearingWallet } from "@/types/bank-account";
import { Button } from "@/components/ui/button";

export function BankQrUploader({
  bankAccountId,
  bankName,
  accountName,
  accountNo,
  qrImageUrl,
  qrLabel,
  promptpayNote,
  isQrCustomerVisible,
}: {
  bankAccountId: string;
  bankName: string;
  accountName: string;
  accountNo: string;
  qrImageUrl?: string | null;
  qrLabel?: string | null;
  promptpayNote?: string | null;
  isQrCustomerVisible: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(qrLabel ?? "");
  const [note, setNote] = useState(promptpayNote ?? "");
  const [visible, setVisible] = useState(isQrCustomerVisible);
  const [preview, setPreview] = useState(qrImageUrl ?? "");
  const [pending, startTransition] = useTransition();
  const platformWallet = isPlatformClearingWallet({
    accountNo,
    bankName,
    accountName,
    qrLabel: label,
  });
  const noteDirty = label !== (qrLabel ?? "") || note !== (promptpayNote ?? "");

  useEffect(() => {
    const block = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  function onDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (file) void submit(file);
  }

  function settingsPayload() {
    return {
      id: bankAccountId,
      qr_label: label.trim() || null,
      promptpay_note: note.trim() || null,
      is_qr_customer_visible: visible,
    };
  }

  async function submit(file: File) {
    const image = await compressImage(file);
    const formData = new FormData();
    formData.set("bank_account_id", bankAccountId);
    formData.set("qr_label", label);
    formData.set("promptpay_note", note);
    formData.set("is_qr_customer_visible", visible ? "true" : "false");
    formData.set("file", image);
    startTransition(async () => {
      const result = await uploadSupthaveeBankQrAction(formData);
      if (!result.success) {
        toast.error(result.error ?? "อัปโหลด QR ไม่สำเร็จ");
        return;
      }
      setPreview(URL.createObjectURL(image));
      toast.success("บันทึก QR รับเงินแล้ว");
    });
  }

  return (
    <div className={`mt-2 space-y-2 rounded-lg border p-2 ${platformWallet ? "border-slate-300 bg-slate-50" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${visible && !platformWallet ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
          {platformWallet ? "กระเป๋าพักเงินแพลตฟอร์ม (ไม่ส่งลูกค้า)" : visible ? "แสดงใน #qr" : "ซ่อนจาก #qr"}
        </span>
      </div>
      {platformWallet ? null : (
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={visible}
            disabled={pending}
            onChange={(event) => {
              const checked = event.target.checked;
              setVisible(checked);
              startTransition(async () => {
                const result = await updateSupthaveeBankQrSettingsAction({
                  id: bankAccountId,
                  qr_label: qrLabel ?? null,
                  promptpay_note: promptpayNote ?? null,
                  is_qr_customer_visible: checked,
                });
                if (!result.success) {
                  setVisible(!checked);
                  toast.error(result.error ?? "บันทึกการแสดงใน #qr ไม่สำเร็จ");
                  return;
                }
                toast.success(checked ? "เปิดส่งใน #qr แล้ว" : "ซ่อนจากคำสั่ง #qr แล้ว");
                router.refresh();
              });
            }}
          />
          อนุญาตส่งในคำสั่ง #qr ลูกค้า
        </label>
      )}
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="QR รับเงิน" className="h-24 w-24 rounded border border-slate-200 object-contain" />
      ) : null}
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="ชื่อเรียก QR (เช่น บริษัท, กรุงเทพ)"
        className="h-8 w-full rounded border border-slate-200 px-2 text-xs"
      />
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="หมายเหตุพร้อมเพย์/การโอน"
        className="h-8 w-full rounded border border-slate-200 px-2 text-xs"
      />
      <Button
        type="button"
        size="sm"
        variant={noteDirty ? "default" : "outline"}
        className={noteDirty ? "bg-blue-700 text-white hover:bg-blue-800" : ""}
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await updateSupthaveeBankQrSettingsAction({
              ...settingsPayload(),
              is_qr_customer_visible: platformWallet ? false : visible,
            });
            if (!result.success) toast.error(result.error ?? "บันทึกตั้งค่า QR ไม่สำเร็จ");
            else {
              toast.success("บันทึกชื่อเรียกและหมายเหตุ QR แล้ว");
              router.refresh();
            }
          });
        }}
      >
        💾 บันทึกชื่อเรียก/หมายเหตุ QR
      </Button>
      <label
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="block cursor-pointer rounded border border-dashed border-slate-300 px-2 py-2 text-xs text-slate-600"
      >
        ลากรูป QR มาวาง หรือเลือกไฟล์
        <input
          type="file"
          accept="image/*"
          className="mt-1 block w-full text-xs"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void submit(file);
          }}
        />
      </label>
      {preview ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const result = await clearSupthaveeBankQrAction(bankAccountId);
              if (!result.success) {
                toast.error(result.error ?? "ล้าง QR ไม่สำเร็จ");
                return;
              }
              setPreview("");
              toast.success("ล้าง QR แล้ว");
            });
          }}
        >
          ล้าง QR
        </Button>
      ) : null}
    </div>
  );
}
