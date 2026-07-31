"use client";

/**
 * Duplicate (Repeat Order) — Client island only.
 * Calls `duplicateDocument` Server Action. Never touches Supabase client.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { duplicateDocument } from "@/lib/actions/document-actions";
import { Button } from "@/components/ui/button";

export type DuplicateDocumentButtonProps = {
  documentId: string;
  docNo: string;
};

export default function DuplicateDocumentButton({
  documentId,
  docNo,
}: DuplicateDocumentButtonProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  async function handleDuplicate() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const result = await duplicateDocument(documentId);
      if (result.error || !result.data) {
        toast.error(result.error ?? "คัดลอกเอกสารไม่สำเร็จ");
        return;
      }

      toast.success(
        `สร้างเอกสารร่างจาก ${docNo}: ${result.data.document_no}`,
      );
      router.push(
        `/sales/${encodeURIComponent(result.data.document_no)}`,
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "คัดลอกเอกสารไม่สำเร็จ",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 gap-2"
      disabled={isSaving}
      onClick={() => {
        void handleDuplicate();
      }}
    >
      {isSaving ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Copy className="size-4" />
      )}
      {isSaving ? "กำลังคัดลอก..." : "คัดลอกเอกสาร"}
    </Button>
  );
}
