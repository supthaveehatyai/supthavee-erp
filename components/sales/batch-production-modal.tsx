"use client";

/**
 * Batch MTO Modal — 1 Mockup ต่อรุ่นสินค้า (ครอบคลุมทุกไซส์/SKU)
 * Zero Client-Side Fetching: upload + batch send ผ่าน Server Actions
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Factory,
  ImagePlus,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  batchSendToProduction,
  uploadBatchModelMockup,
} from "@/lib/actions/production/batch-send-to-production";
import { compressImage } from "@/lib/utils/image-compression";
import type { ManufacturedSendGroup } from "@/types/production";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type BatchProductionModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentNo: string;
  pendingGroups: ManufacturedSendGroup[];
  sentCount?: number;
};

type ModelDraft = {
  previewUrl: string | null;
  uploadedUrl: string | null;
  fileName: string | null;
  uploading: boolean;
};

function emptyDraft(): ModelDraft {
  return {
    previewUrl: null,
    uploadedUrl: null,
    fileName: null,
    uploading: false,
  };
}

export function BatchProductionModal({
  open,
  onOpenChange,
  documentId,
  documentNo,
  pendingGroups,
  sentCount = 0,
}: BatchProductionModalProps) {
  const router = useRouter();
  const [isSubmitting, startSubmit] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, ModelDraft>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const busy =
    isSubmitting || Object.values(drafts).some((draft) => draft.uploading);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, ModelDraft> = {};
    for (const group of pendingGroups) {
      const existing = group.mockup_image_url?.trim() || null;
      next[group.finished_model_id] = {
        previewUrl: existing,
        uploadedUrl: existing,
        fileName: existing ? "mockup เดิม" : null,
        uploading: false,
      };
    }
    setDrafts(next);
  }, [open, pendingGroups]);

  const totalSku = useMemo(
    () =>
      pendingGroups.reduce((sum, group) => sum + group.items.length, 0),
    [pendingGroups],
  );
  const totalQty = useMemo(
    () =>
      pendingGroups.reduce(
        (sum, group) =>
          sum +
          group.items.reduce(
            (inner, item) => inner + Number(item.quantity ?? 0),
            0,
          ),
        0,
      ),
    [pendingGroups],
  );

  async function handlePickFile(
    finishedModelId: string,
    file: File | null | undefined,
  ) {
    if (!file || busy) return;

    setDrafts((prev) => ({
      ...prev,
      [finishedModelId]: {
        ...(prev[finishedModelId] ?? emptyDraft()),
        uploading: true,
        fileName: file.name,
      },
    }));

    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.set("file", compressed);

      const result = await uploadBatchModelMockup(
        documentId,
        finishedModelId,
        formData,
      );

      if (!result.success || !result.data) {
        toast.error(result.error ?? "อัปโหลด Mockup ไม่สำเร็จ");
        setDrafts((prev) => ({
          ...prev,
          [finishedModelId]: {
            ...(prev[finishedModelId] ?? emptyDraft()),
            uploading: false,
          },
        }));
        return;
      }

      const url = result.data.url;
      setDrafts((prev) => ({
        ...prev,
        [finishedModelId]: {
          previewUrl: url,
          uploadedUrl: url,
          fileName: compressed.name || file.name,
          uploading: false,
        },
      }));
      toast.success("อัปโหลด Mockup สำเร็จ");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "อัปโหลด Mockup ไม่สำเร็จ",
      );
      setDrafts((prev) => ({
        ...prev,
        [finishedModelId]: {
          ...(prev[finishedModelId] ?? emptyDraft()),
          uploading: false,
        },
      }));
    }
  }

  function handleConfirm() {
    if (pendingGroups.length === 0 || busy) return;

    startSubmit(async () => {
      const modelMockups: Record<string, string> = {};
      for (const group of pendingGroups) {
        const url =
          drafts[group.finished_model_id]?.uploadedUrl?.trim() ||
          group.mockup_image_url?.trim() ||
          "";
        if (url) {
          modelMockups[group.finished_model_id] = url;
        }
      }

      const result = await batchSendToProduction(documentId, modelMockups);
      if (!result.success || !result.data) {
        toast.error(result.error ?? "ส่งงานผลิตไม่สำเร็จ");
        return;
      }

      const jobCount = result.data.jobs.length;
      const firstJob = result.data.jobs[0]?.job_no;
      toast.success(
        jobCount === 1 && firstJob
          ? `ยิงงานเข้า Kanban ผลิตเรียบร้อยแล้ว (${firstJob})`
          : `ยิงงานเข้า Kanban ผลิตเรียบร้อยแล้ว (${jobCount} รุ่น)`,
      );
      if (result.error) {
        toast.warning(result.error);
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Factory className="size-5 text-violet-600" aria-hidden />
            Batch ส่งงานผลิต (MTO)
          </DialogTitle>
          <DialogDescription>
            SO{" "}
            <span className="font-mono font-semibold text-slate-700">
              {documentNo}
            </span>{" "}
            — อัปโหลด Mockup{" "}
            <span className="font-semibold text-slate-700">1 รูปต่อรุ่น</span>{" "}
            ครอบคลุมทุกไซส์ ·{" "}
            {pendingGroups.length.toLocaleString("th-TH")} รุ่น ·{" "}
            {totalSku.toLocaleString("th-TH")} SKU · รวม{" "}
            {totalQty.toLocaleString("th-TH")} ชิ้น
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {pendingGroups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
              ไม่มีรุ่นที่รอส่งผลิต
            </p>
          ) : (
            pendingGroups.map((group) => {
              const draft = drafts[group.finished_model_id] ?? emptyDraft();
              const qty = group.items.reduce(
                (sum, item) => sum + Number(item.quantity ?? 0),
                0,
              );
              return (
                <div
                  key={group.finished_model_id}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        <span className="font-mono text-xs text-slate-500">
                          {group.model_code}
                        </span>{" "}
                        <span className="line-clamp-1">{group.model_name}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {group.items.length} SKU / ไซส์ · รวม{" "}
                        {qty.toLocaleString("th-TH")} ชิ้น
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-3">
                    <div
                      className={cn(
                        "relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed",
                        draft.previewUrl
                          ? "border-violet-200 bg-violet-50/40"
                          : "border-slate-200 bg-slate-50",
                      )}
                    >
                      {draft.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={draft.previewUrl}
                          alt={`Mockup ${group.model_code}`}
                          className="size-full object-cover"
                        />
                      ) : (
                        <ImagePlus
                          className="size-6 text-slate-300"
                          aria-hidden
                        />
                      )}
                      {draft.uploading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                          <Loader2 className="size-5 animate-spin text-violet-600" />
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-xs font-semibold text-slate-700">
                        Mockup (1 รูปต่อรุ่น)
                      </p>
                      <p className="text-[11px] leading-snug text-slate-400">
                        ใช้ร่วมกันทุกไซส์ในรุ่นนี้ — ไม่ต้องอัปโหลดซ้ำทีละบรรทัด
                      </p>
                      {draft.fileName ? (
                        <p className="truncate font-mono text-[10px] text-slate-500">
                          {draft.fileName}
                        </p>
                      ) : null}
                      <div>
                        <input
                          ref={(el) => {
                            fileInputRefs.current[group.finished_model_id] = el;
                          }}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          disabled={busy}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            void handlePickFile(
                              group.finished_model_id,
                              file,
                            );
                            event.target.value = "";
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          disabled={busy}
                          onClick={() =>
                            fileInputRefs.current[
                              group.finished_model_id
                            ]?.click()
                          }
                        >
                          {draft.uploading ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Upload className="size-3.5" />
                          )}
                          {draft.uploadedUrl ? "เปลี่ยนรูป" : "อัปโหลด Mockup"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {sentCount > 0 ? (
            <p className="px-1 text-xs text-emerald-700">
              ส่งแล้ว {sentCount} รุ่น — จะข้ามไม่สร้างซ้ำ
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t border-slate-200 px-5 py-4 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            disabled={busy || pendingGroups.length === 0}
            onClick={handleConfirm}
            className="gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังส่ง...
              </>
            ) : (
              <>
                <Factory className="size-4" />
                ยืนยันส่ง {pendingGroups.length} รุ่น
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BatchProductionModal;
