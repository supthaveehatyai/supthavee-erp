"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { clearSupthaveeBankQrAction, uploadSupthaveeBankQrAction } from "@/lib/actions/bank-accounts";
import { compressImage } from "@/lib/utils/image-compression";
import { Button } from "@/components/ui/button";

export function BankQrUploader({
  bankAccountId,
  qrImageUrl,
  promptpayNote,
}: {
  bankAccountId: string;
  qrImageUrl?: string | null;
  promptpayNote?: string | null;
}) {
  const [note, setNote] = useState(promptpayNote ?? "");
  const [preview, setPreview] = useState(qrImageUrl ?? "");
  const [pending, startTransition] = useTransition();

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

  async function submit(file: File) {
    const image = await compressImage(file);
    const formData = new FormData();
    formData.set("bank_account_id", bankAccountId);
    formData.set("promptpay_note", note);
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
    <div className="mt-2 space-y-2">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="QR รับเงิน" className="h-24 w-24 rounded border border-slate-200 object-contain" />
      ) : null}
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="หมายเหตุพร้อมเพย์"
        className="h-8 w-full rounded border border-slate-200 px-2 text-xs"
      />
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
              setNote("");
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
