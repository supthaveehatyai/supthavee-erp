"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { saveLegalEntityAction } from "@/lib/actions/holding-entities";
import { WORKSPACE_THEMES, type LegalEntityRow, type WorkspaceKey } from "@/types/holding";
import { Button } from "@/components/ui/button";

const WORKSPACES: WorkspaceKey[] = ["supthavee", "fnb", "agri", "prop", "holding"];

export function EntitiesWorkspace({
  entities,
  schemaMessage,
}: {
  entities: LegalEntityRow[];
  schemaMessage: string | null;
}) {
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    startTransition(async () => {
      const result = await saveLegalEntityAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success("บันทึกนิติบุคคลแล้ว");
    });
  }

  return (
    <div className="space-y-4">
      {schemaMessage ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{schemaMessage}</div> : null}
      <form action={save} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4">
        <input name="entity_code" required placeholder="รหัส ASCII เช่น STV" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="entity_name_th" required placeholder="ชื่อนิติบุคคล" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="tax_id" placeholder="เลขผู้เสียภาษี" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <select name="primary_workspace" className="h-10 rounded border border-slate-200 px-3 text-sm">
          {WORKSPACES.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
        </select>
        <Button type="submit" disabled={pending}>เพิ่มนิติบุคคล</Button>
      </form>
      <div className="space-y-3">
        {entities.map((entity) => (
          <form key={entity.id} action={save} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4">
            <input type="hidden" name="id" value={entity.id} />
            <input name="entity_code" defaultValue={entity.entity_code} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <input name="entity_name_th" defaultValue={entity.entity_name_th} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <input name="tax_id" defaultValue={entity.tax_id ?? ""} className="h-10 rounded border border-slate-200 px-3 text-sm" />
            <select name="primary_workspace" defaultValue={entity.primary_workspace ?? "holding"} className="h-10 rounded border border-slate-200 px-3 text-sm">
              {WORKSPACES.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
            </select>
            <select name="is_active" defaultValue={entity.is_active ? "true" : "false"} className="h-10 rounded border border-slate-200 px-3 text-sm">
              <option value="true">ใช้งาน</option>
              <option value="false">ปิด</option>
            </select>
            <Button type="submit" variant="outline" disabled={pending}>บันทึกการแก้ไข</Button>
          </form>
        ))}
      </div>
    </div>
  );
}
