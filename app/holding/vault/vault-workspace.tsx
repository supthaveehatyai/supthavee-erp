"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  archiveCorporateDocumentAction,
  getCorporateDocumentSignedUrlAction,
  updateCorporateDocumentMetaAction,
  uploadCorporateDocumentAction,
} from "@/lib/actions/holding-vault";
import { compressImage } from "@/lib/utils/image-compression";
import {
  VAULT_CATEGORIES,
  WORKSPACE_THEMES,
  type CorporateDocumentRow,
  type LegalEntityRow,
  type WorkspaceKey,
} from "@/types/holding";
import { Button } from "@/components/ui/button";

const WORKSPACE_OPTIONS: WorkspaceKey[] = ["supthavee", "fnb", "agri", "prop", "holding"];

function expiryState(value: string | null): "ok" | "soon" | "expired" {
  if (!value) return "ok";
  const date = new Date(`${value.slice(0, 10)}T00:00:00+07:00`);
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (days < 0) return "expired";
  if (days < 30) return "soon";
  return "ok";
}

export function VaultWorkspace({
  documents,
  entities,
  schemaMessage,
  initialWorkspace,
}: {
  documents: CorporateDocumentRow[];
  entities: LegalEntityRow[];
  schemaMessage: string | null;
  initialWorkspace: string;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace || "all");
  const [entityId, setEntityId] = useState("all");
  const [category, setCategory] = useState("all");
  const [keyword, setKeyword] = useState("");
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

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return documents.filter((doc) => {
      if (workspace !== "all" && doc.workspace_key !== workspace) return false;
      if (entityId !== "all" && doc.entity_id !== entityId) return false;
      if (category !== "all" && doc.category !== category) return false;
      if (!needle) return true;
      return `${doc.title} ${doc.entity_name ?? ""} ${doc.notes ?? ""}`.toLowerCase().includes(needle);
    });
  }, [documents, workspace, entityId, category, keyword]);

  async function openSigned(documentId: string, mode: "view" | "download" | "copy") {
    const result = await getCorporateDocumentSignedUrlAction(documentId);
    if (!result.data.url) {
      toast.error(result.error ?? "สร้างลิงก์ไม่สำเร็จ");
      return;
    }
    if (mode === "copy") {
      await navigator.clipboard.writeText(result.data.url);
      toast.success("คัดลอกลิงก์ชั่วคราว 1 ชั่วโมงแล้ว");
      return;
    }
    if (mode === "download") {
      const anchor = document.createElement("a");
      anchor.href = result.data.url;
      anchor.download = "";
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.click();
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-6">
      {schemaMessage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {schemaMessage}
        </div>
      ) : null}

      <form
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);
          const file = formData.get("file");
          startTransition(async () => {
            if (file instanceof File && file.type.startsWith("image/")) {
              formData.set("file", await compressImage(file));
            }
            const result = await uploadCorporateDocumentAction(formData);
            if (result.error) {
              toast.error(result.error);
              return;
            }
            toast.success("บันทึกเอกสารเข้าคลังแล้ว");
            form.reset();
          });
        }}
      >
        <input name="title" required placeholder="ชื่อเอกสาร" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <select name="category" className="h-10 rounded border border-slate-200 px-3 text-sm" defaultValue={VAULT_CATEGORIES[0]}>
          {VAULT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select name="workspace_key" className="h-10 rounded border border-slate-200 px-3 text-sm" defaultValue={initialWorkspace || "holding"}>
          {WORKSPACE_OPTIONS.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
        </select>
        <select name="entity_id" className="h-10 rounded border border-slate-200 px-3 text-sm" defaultValue="">
          <option value="">ไม่ระบุนิติบุคคล</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>{entity.legal_name}</option>
          ))}
        </select>
        <input name="entity_code" placeholder="รหัส ASCII เช่น STV" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="issue_date" type="date" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="expiry_date" type="date" className="h-10 rounded border border-slate-200 px-3 text-sm" />
        <input name="notes" placeholder="หมายเหตุ" className="h-10 rounded border border-slate-200 px-3 text-sm md:col-span-2" />
        <label
          className="rounded border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600 md:col-span-3"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const file = event.dataTransfer.files?.[0];
            const input = event.currentTarget.querySelector("input");
            if (file && input) {
              const transfer = new DataTransfer();
              transfer.items.add(file);
              input.files = transfer.files;
            }
          }}
        >
          ลาก PDF หรือรูปภาพมาวาง (ไม่เกิน 20MB)
          <input name="file" required type="file" accept="application/pdf,image/*" className="mt-2 block w-full text-sm" />
        </label>
        <Button type="submit" disabled={pending}>บันทึกเข้าคลัง</Button>
      </form>

      <div className="grid gap-2 md:grid-cols-4">
        <select value={workspace} onChange={(event) => setWorkspace(event.target.value)} className="h-10 rounded border border-slate-200 px-3 text-sm">
          <option value="all">ทุกธุรกิจ</option>
          {WORKSPACE_OPTIONS.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
        </select>
        <select value={entityId} onChange={(event) => setEntityId(event.target.value)} className="h-10 rounded border border-slate-200 px-3 text-sm">
          <option value="all">ทรัพย์ทวี, จัสมิน พลัส, ลิ่มวรวิวัฒน์, บุคคลในครอบครัว</option>
          {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name}</option>)}
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 rounded border border-slate-200 px-3 text-sm">
          <option value="all">ทุกหมวด</option>
          {VAULT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="ค้นหา" className="h-10 rounded border border-slate-200 px-3 text-sm" />
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีเอกสารในตัวกรองนี้</p> : null}
        {filtered.map((doc) => {
          const expiry = expiryState(doc.expiry_date);
          return (
            <article key={doc.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{doc.title}</h2>
                  <p className="text-xs text-slate-500">
                    {doc.entity_name ?? "ไม่ระบุนิติบุคคล"} · {WORKSPACE_THEMES[doc.workspace_key].label} · {doc.category}
                  </p>
                  <p className="text-xs text-slate-500">
                    ออก {doc.issue_date ?? "—"} · หมดอายุ {doc.expiry_date ?? "—"}
                  </p>
                  {expiry === "expired" ? <span className="text-xs font-semibold text-red-700">หมดอายุแล้ว</span> : null}
                  {expiry === "soon" ? <span className="text-xs font-semibold text-amber-700">ใกล้หมดอายุภายใน 30 วัน</span> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void openSigned(doc.id, "view")}>เปิดดู / พิมพ์ทันที</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void openSigned(doc.id, "download")}>ดาวน์โหลด</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void openSigned(doc.id, "copy")}>คัดลอกลิงก์ชั่วคราว (1 ชม.)</Button>
                </div>
              </div>
              <form
                className="mt-3 grid gap-2 md:grid-cols-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  startTransition(async () => {
                    const result = await updateCorporateDocumentMetaAction(formData);
                    if (result.error) toast.error(result.error);
                    else toast.success("แก้ไขข้อมูลเอกสารแล้ว");
                  });
                }}
              >
                <input type="hidden" name="id" value={doc.id} />
                <input name="title" defaultValue={doc.title} className="h-9 rounded border border-slate-200 px-2 text-sm" />
                <select name="category" defaultValue={doc.category} className="h-9 rounded border border-slate-200 px-2 text-sm">
                  {VAULT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
                </select>
                <select name="workspace_key" defaultValue={doc.workspace_key} className="h-9 rounded border border-slate-200 px-2 text-sm">
                  {WORKSPACE_OPTIONS.map((key) => <option key={key} value={key}>{WORKSPACE_THEMES[key].label}</option>)}
                </select>
                <input name="issue_date" type="date" defaultValue={doc.issue_date?.slice(0, 10) ?? ""} className="h-9 rounded border border-slate-200 px-2 text-sm" />
                <input name="expiry_date" type="date" defaultValue={doc.expiry_date?.slice(0, 10) ?? ""} className="h-9 rounded border border-slate-200 px-2 text-sm" />
                <input name="notes" defaultValue={doc.notes ?? ""} placeholder="หมายเหตุ" className="h-9 rounded border border-slate-200 px-2 text-sm" />
                <Button type="submit" size="sm" variant="outline" disabled={pending}>บันทึกการแก้ไข</Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await archiveCorporateDocumentAction(doc.id);
                      if (result.error) toast.error(result.error);
                      else toast.success("เก็บเอกสารเข้าแฟ้มแล้ว");
                    });
                  }}
                >
                  เก็บเข้าแฟ้ม
                </Button>
              </form>
            </article>
          );
        })}
      </div>
    </div>
  );
}
