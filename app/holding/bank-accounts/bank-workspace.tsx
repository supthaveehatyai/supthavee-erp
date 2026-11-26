"use client";

import { useEffect, useTransition } from "react";
import { toast } from "sonner";
import { saveHoldingBankAccountAction, uploadHoldingBankQrAction } from "@/lib/actions/holding-entities";
import { compressImage } from "@/lib/utils/image-compression";
import { WORKSPACE_THEMES, type HoldingBankAccountRow, type LegalEntityRow, type WorkspaceKey } from "@/types/holding";
import { Button } from "@/components/ui/button";

const WORKSPACES: WorkspaceKey[] = ["supthavee", "fnb", "agri", "prop", "holding"];

export function HoldingBankWorkspace({
  accounts,
  entities,
  schemaMessage,
  initialWorkspace,
}: {
  accounts: HoldingBankAccountRow[];
  entities: LegalEntityRow[];
  schemaMessage: string | null;
  initialWorkspace: string;
}) {
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  function save(formData: FormData) {
    startTransition(async () => {
      const result = await saveHoldingBankAccountAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success("บันทึกบัญชีแล้ว");
    });
  }

  return (
    <div className="space-y-4">
      {schemaMessage ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{schemaMessage}</div> : null}
      <form action={save} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3">
        <select name="workspace_key" defaultValue={initialWorkspace || "holding"} className="h-10 rounded border border-slate-200 px-3 text-sm">
          {WORKSPACES.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
        </select>
        <select name="entity_id" className="h-10 rounded border border-slate-200 px-3 text-sm" defaultValue="">
          <option value="">ไม่ระบุนิติบุคคล</option>
          {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name}</option>)}
        </select>
        <input name="bank_name" required placeholder="ธนาคาร" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="account_no" required placeholder="เลขบัญชีเต็ม" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="account_name" required placeholder="ชื่อบัญชี" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="branch_name" placeholder="สาขา" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="promptpay_note" placeholder="หมายเหตุพร้อมเพย์" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="sort_order" type="number" defaultValue={10} className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_default_receiving" value="true" /> บัญชีรับเงินหลัก</label>
        <Button type="submit" disabled={pending}>เพิ่มบัญชี</Button>
      </form>
      <div className="space-y-3">
        {accounts.map((account) => (
          <form key={account.id} action={save} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3">
            <input type="hidden" name="id" value={account.id} />
            <select name="workspace_key" defaultValue={account.workspace_key} className="h-10 rounded border border-slate-200 px-3 text-sm">
              {WORKSPACES.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
            </select>
            <select name="entity_id" defaultValue={account.entity_id ?? ""} className="h-10 rounded border border-slate-200 px-3 text-sm">
              <option value="">ไม่ระบุนิติบุคคล</option>
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name}</option>)}
            </select>
            <input name="bank_name" defaultValue={account.bank_name} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <input name="account_no" defaultValue={account.account_no} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <input name="account_name" defaultValue={account.account_name} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <input name="branch_name" defaultValue={account.branch_name ?? ""} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <input name="promptpay_note" defaultValue={account.promptpay_note ?? ""} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <input name="sort_order" type="number" defaultValue={account.sort_order} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <select name="is_active" defaultValue={account.is_active ? "true" : "false"} className="h-10 rounded border border-slate-200 px-3 text-sm">
              <option value="true">ใช้งาน</option>
              <option value="false">ปิด</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_default_receiving" value="true" defaultChecked={account.is_default_receiving} />
              บัญชีรับเงินหลัก
            </label>
            {account.qr_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.qr_image_url} alt="QR" className="h-24 w-24 rounded border object-contain" />
            ) : null}
            <label
              className="text-xs text-slate-600"
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const file = event.dataTransfer.files?.[0];
                if (!file) return;
                void uploadQr(account.id, account.workspace_key, file);
              }}
            >
              วางรูป QR รับเงิน
              <input
                type="file"
                accept="image/*"
                className="mt-1 block"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadQr(account.id, account.workspace_key, file);
                }}
              />
            </label>
            <Button type="submit" variant="outline" disabled={pending}>บันทึกการแก้ไข</Button>
          </form>
        ))}
      </div>
    </div>
  );

  async function uploadQr(bankAccountId: string, workspaceKey: WorkspaceKey, file: File) {
    const image = await compressImage(file);
    const formData = new FormData();
    formData.set("bank_account_id", bankAccountId);
    formData.set("workspace_key", workspaceKey);
    formData.set("file", image);
    startTransition(async () => {
      const result = await uploadHoldingBankQrAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success("อัปโหลด QR แล้ว");
    });
  }
}
