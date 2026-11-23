"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteColorwayImageAction,
  getModelCropperStateAction,
  uploadColorwayCroppedImageAction,
  uploadModelMasterPosterAction,
} from "@/lib/actions/colorway-catalog-actions";
import { compressImage } from "@/lib/utils/image-compression";
import type {
  ModelColorCropperItem,
  ModelColorCropperState,
} from "@/types/colorway-catalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type AspectMode = "1:1" | "3:4" | "free";

type CropNorm = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type PosterColorwayCropperDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  modelCode?: string;
  modelName?: string;
  onSaved?: () => void;
};

const ASPECT_RATIO: Record<Exclude<AspectMode, "free">, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
};

function clamp01(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampCrop(crop: CropNorm): CropNorm {
  const w = clamp01(crop.w, 0.08, 1);
  const h = clamp01(crop.h, 0.08, 1);
  return {
    x: clamp01(crop.x, 0, 1 - w),
    y: clamp01(crop.y, 0, 1 - h),
    w,
    h,
  };
}

function defaultCrop(aspect: AspectMode, displayRatio: number): CropNorm {
  if (aspect === "free") return { x: 0.12, y: 0.08, w: 0.76, h: 0.84 };
  const ratio = ASPECT_RATIO[aspect];
  let w = 0.72;
  let h = (w * displayRatio) / ratio;
  if (h > 0.88) {
    h = 0.88;
    w = (h * ratio) / displayRatio;
  }
  return clampCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

function firstImageFile(list: FileList | null | undefined): File | null {
  const file = list?.[0];
  if (!file || !file.type.toLowerCase().startsWith("image/")) return null;
  return file;
}

export function PosterColorwayCropperDialog({
  open,
  onOpenChange,
  modelId,
  modelCode = "",
  modelName = "",
  onSaved,
}: PosterColorwayCropperDialogProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const localUrlRef = useRef<string | null>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const cropRef = useRef<CropNorm>({ x: 0.15, y: 0.08, w: 0.7, h: 0.84 });
  const dragRef = useRef<{
    mode: "move" | "resize";
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const [state, setState] = useState<ModelColorCropperState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedColorId, setSelectedColorId] = useState("");
  const [localPosterUrl, setLocalPosterUrl] = useState<string | null>(null);
  const [localPosterFile, setLocalPosterFile] = useState<File | null>(null);
  const [cdnFailed, setCdnFailed] = useState(false);
  const [frameWidth, setFrameWidth] = useState(520);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<AspectMode>("3:4");
  const [crop, setCrop] = useState<CropNorm>({ x: 0.15, y: 0.08, w: 0.7, h: 0.84 });
  const [busy, setBusy] = useState(false);
  const [dragOverPoster, setDragOverPoster] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function updateCrop(next: CropNorm) {
    cropRef.current = next;
    setCrop(next);
  }

  const posterUrl = (state?.model.poster_image_url ?? "").trim();
  const imageSrc = localPosterUrl || (!cdnFailed ? posterUrl : "");
  const innerWidth = Math.max(280, frameWidth) * zoom;
  const innerHeight =
    natural.w > 0 ? innerWidth * (natural.h / natural.w) : Math.round(innerWidth * 1.25);
  const selected =
    state?.colors.find((color) => color.color_id === selectedColorId) ?? null;

  function replaceLocalPoster(file: File | null) {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    if (!file) {
      localUrlRef.current = null;
      setLocalPosterUrl(null);
      setLocalPosterFile(null);
      return;
    }
    const url = URL.createObjectURL(file);
    localUrlRef.current = url;
    setLocalPosterUrl(url);
    setLocalPosterFile(file);
    setCdnFailed(false);
    setZoom(1);
  }

  useEffect(() => {
    if (!open) return;
    const block = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      replaceLocalPoster(null);
      return;
    }
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setFrameWidth(Math.max(280, frame.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [open, imageSrc]);

  useEffect(() => {
    if (!open || !modelId) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    setState(null);
    setSelectedColorId("");
    setCdnFailed(false);
    setConfirmDeleteId(null);
    void getModelCropperStateAction(modelId).then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.error || !result.state) {
        setLoadError(result.error ?? "โหลดสีของรุ่นนี้ไม่สำเร็จ");
        return;
      }
      setState(result.state);
      const first =
        result.state.colors.find((color) => !color.colorway_image_url) ??
        result.state.colors[0];
      setSelectedColorId(first?.color_id ?? "");
    });
    return () => {
      active = false;
    };
  }, [open, modelId]);

  useEffect(() => {
    return () => {
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!selectedColorId) return;
    document
      .getElementById(`colorway-row-${selectedColorId}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedColorId, state]);

  function applyAspect(next: AspectMode) {
    setAspect(next);
    if (natural.w > 0) updateCrop(defaultCrop(next, natural.w / natural.h));
  }

  function onImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNatural({ w, h });
    if (w > 0 && h > 0) updateCrop(defaultCrop(aspect, w / h));
  }

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const origin = cropRef.current;
      const dx = (event.clientX - drag.x) / drag.width;
      const dy = (event.clientY - drag.y) / drag.height;
      drag.x = event.clientX;
      drag.y = event.clientY;
      const displayRatio = drag.width / Math.max(drag.height, 1);
      let next: CropNorm;
      if (drag.mode === "move") {
        next = clampCrop({ ...origin, x: origin.x + dx, y: origin.y + dy });
      } else if (aspect === "free") {
        next = clampCrop({ ...origin, w: origin.w + dx, h: origin.h + dy });
      } else {
        const ratio = ASPECT_RATIO[aspect];
        let w = origin.w + dx;
        let h = (w * displayRatio) / ratio;
        if (origin.y + h > 1) {
          h = 1 - origin.y;
          w = (h * ratio) / displayRatio;
        }
        if (origin.x + w > 1) {
          w = 1 - origin.x;
          h = (w * displayRatio) / ratio;
        }
        next = clampCrop({ x: origin.x, y: origin.y, w, h });
      }
      cropRef.current = next;
      setCrop(next);
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [aspect]);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>, mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      x: event.clientX,
      y: event.clientY,
      width: innerWidth,
      height: innerHeight,
    };
  }

  async function refreshColors(preferColorId?: string) {
    const result = await getModelCropperStateAction(modelId);
    if (result.error || !result.state) {
      toast.error(result.error ?? "โหลดสีของรุ่นนี้ไม่สำเร็จ");
      return;
    }
    setState(result.state);
    if (!preferColorId) return;
    const colors = result.state.colors;
    const start = Math.max(
      0,
      colors.findIndex((color) => color.color_id === preferColorId),
    );
    const rotated = [...colors.slice(start + 1), ...colors.slice(0, start + 1)];
    const next = rotated.find(
      (color) => !color.colorway_image_url && color.color_id !== preferColorId,
    );
    setSelectedColorId((next ?? colors[start] ?? colors[0])?.color_id ?? "");
  }

  async function submitColorFile(
    color: ModelColorCropperItem,
    file: File,
    cropMeta: Record<string, unknown>,
  ) {
    setBusy(true);
    try {
      let compressed: File;
      try {
        compressed = await compressImage(file);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "บีบอัดรูปไม่สำเร็จ");
        return;
      }
      const formData = new FormData();
      formData.set("file", compressed);
      formData.set("modelId", state?.model.model_id || modelId);
      formData.set("colorId", color.color_id);
      formData.set("modelCode", state?.model.model_code || modelCode);
      formData.set("colorCode", color.color_code);
      formData.set(
        "sourcePosterUrl",
        localPosterUrl ? "" : posterUrl,
      );
      formData.set("cropMeta", JSON.stringify(cropMeta));
      const result = await uploadColorwayCroppedImageAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`บันทึกรูปสี ${color.color_name} แล้ว`);
      onSaved?.();
      await refreshColors(color.color_id);
    } finally {
      setBusy(false);
    }
  }

  async function cropAndSave() {
    if (!selected) {
      toast.error("เลือกสีก่อนตัดรูป");
      return;
    }
    const img = imgRef.current;
    if (!img || natural.w <= 0 || !imageSrc) {
      toast.error("ยังไม่มีโปสเตอร์ให้ตัด — เลือกไฟล์จากเครื่อง");
      return;
    }
    const sx = Math.round(crop.x * natural.w);
    const sy = Math.round(crop.y * natural.h);
    const sw = Math.max(1, Math.round(crop.w * natural.w));
    const sh = Math.max(1, Math.round(crop.h * natural.h));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("เบราว์เซอร์นี้ตัดรูปไม่ได้");
      return;
    }
    try {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
          canvas.toBlob((file) => resolve(file), "image/webp", 0.92);
        } catch (err) {
          reject(err);
        }
      });
      if (!blob) {
        throw new Error("อ่านพิกเซลจากรูปนี้ไม่ได้");
      }
      const file = new File([blob], `${selected.color_code || "color"}.webp`, {
        type: "image/webp",
      });
      await submitColorFile(selected, file, {
        x: crop.x,
        y: crop.y,
        w: crop.w,
        h: crop.h,
        aspect,
        source: localPosterUrl ? "local_poster" : "cdn_poster",
      });
    } catch {
      toast.error("อ่านพิกเซลจากรูป CDN ไม่ได้ — เลือกไฟล์โปสเตอร์จากเครื่องแล้วตัดอีกครั้ง");
    }
  }

  async function uploadDirect(color: ModelColorCropperItem, file: File) {
    setSelectedColorId(color.color_id);
    await submitColorFile(color, file, { source: "direct_upload" });
  }

  async function saveMasterPoster(file: File) {
    setBusy(true);
    try {
      let compressed: File;
      try {
        compressed = await compressImage(file);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "บีบอัดรูปไม่สำเร็จ");
        return;
      }
      const formData = new FormData();
      formData.set("file", compressed);
      formData.set("modelId", state?.model.model_id || modelId);
      formData.set("modelCode", state?.model.model_code || modelCode);
      const result = await uploadModelMasterPosterAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("บันทึกโปสเตอร์รวมของรุ่นแล้ว");
      onSaved?.();
      await refreshColors();
    } finally {
      setBusy(false);
    }
  }

  async function removeColorImage(color: ModelColorCropperItem) {
    setBusy(true);
    try {
      const result = await deleteColorwayImageAction(
        state?.model.model_id || modelId,
        color.color_id,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`สี ${color.color_name} กลับไปใช้โปสเตอร์รวม`);
      setConfirmDeleteId(null);
      onSaved?.();
      await refreshColors(color.color_id);
    } finally {
      setBusy(false);
    }
  }

  const titleName = state?.model.name || modelName || "รุ่นสินค้า";
  const titleCode = state?.model.model_code || modelCode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(1120px,calc(100vw-1.5rem))] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-100 px-5 py-4">
          <DialogTitle>ตัดรูปแยกสี — {titleCode}</DialogTitle>
          <DialogDescription>{titleName}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-20 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            กำลังโหลดสีของรุ่นนี้
          </div>
        ) : loadError ? (
          <div className="px-5 py-16 text-center text-sm text-red-600">{loadError}</div>
        ) : (
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.25fr)_22rem]">
            <section className="flex min-h-0 flex-col border-b border-slate-100 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                {(
                  [
                    ["1:1", "1:1 Square"],
                    ["3:4", "3:4 Portrait"],
                    ["free", "Free"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={aspect === value ? "default" : "outline"}
                    onClick={() => applyAspect(value)}
                  >
                    {label}
                  </Button>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>
                  ขยาย
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))}>
                  ย่อ
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setZoom(1);
                    if (natural.w > 0) updateCrop(defaultCrop(aspect, natural.w / natural.h));
                  }}
                >
                  รีเซ็ต
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => posterInputRef.current?.click()}
                >
                  <ImagePlus className="mr-1 size-3.5" />
                  เลือกโปสเตอร์จากเครื่อง
                </Button>
                <input
                  ref={posterInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = firstImageFile(event.target.files);
                    event.target.value = "";
                    if (file) replaceLocalPoster(file);
                  }}
                />
              </div>

              <div
                ref={frameRef}
                className={cn(
                  "mx-4 mb-3 min-h-[320px] flex-1 overflow-auto rounded-xl border bg-slate-900",
                  dragOverPoster ? "border-blue-400" : "border-slate-800",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragOverPoster(true);
                }}
                onDragLeave={() => setDragOverPoster(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragOverPoster(false);
                  const file = firstImageFile(event.dataTransfer.files);
                  if (!file) {
                    toast.error("วางไฟล์รูป JPG, PNG หรือ WebP");
                    return;
                  }
                  replaceLocalPoster(file);
                }}
              >
                {imageSrc ? (
                  <div className="relative" style={{ width: innerWidth, height: innerHeight }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- canvas crop needs a live image element */}
                    <img
                      ref={imgRef}
                      src={imageSrc}
                      alt={titleName}
                      draggable={false}
                      crossOrigin={imageSrc.startsWith("blob:") ? undefined : "anonymous"}
                      className="pointer-events-none block max-w-none select-none"
                      style={{ width: innerWidth, height: innerHeight }}
                      onLoad={onImageLoad}
                      onError={() => {
                        if (!localPosterUrl) setCdnFailed(true);
                      }}
                    />
                    <div
                      className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(2,6,23,0.55)]"
                      style={{
                        left: `${crop.x * 100}%`,
                        top: `${crop.y * 100}%`,
                        width: `${crop.w * 100}%`,
                        height: `${crop.h * 100}%`,
                      }}
                      onPointerDown={(event) => startDrag(event, "move")}
                    >
                      <div
                        className="absolute -bottom-1.5 -right-1.5 size-4 cursor-nwse-resize rounded-sm border border-slate-300 bg-white"
                        onPointerDown={(event) => startDrag(event, "resize")}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-slate-300">
                    <ImagePlus className="size-8" />
                    <p>ยังไม่มีโปสเตอร์รวม หรือเบราว์เซอร์อ่านรูปจาก CDN ไม่ได้</p>
                    <p>ลากไฟล์โปสเตอร์มาวางที่นี่ แล้วตัดแยกสีได้ทันที</p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
                <Button type="button" disabled={busy || !selected || !imageSrc} onClick={() => void cropAndSave()}>
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  ตัดและบันทึกรูปสี {selected?.color_name || "—"}
                </Button>
                {localPosterFile ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void saveMasterPoster(localPosterFile)}
                  >
                    บันทึกไฟล์นี้เป็นโปสเตอร์รวม
                  </Button>
                ) : null}
                {!posterUrl && !localPosterFile ? (
                  <p className="text-xs text-amber-700">รุ่นนี้ยังไม่มีโปสเตอร์รวมในระบบ</p>
                ) : null}
              </div>
            </section>

            <aside className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">สีของรุ่นนี้</p>
                <p className="text-xs text-slate-500">{state?.colors.length ?? 0} สี</p>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
                {(state?.colors ?? []).map((color) => {
                  const active = color.color_id === selectedColorId;
                  const hasImage = Boolean(color.colorway_image_url);
                  return (
                    <div
                      id={`colorway-row-${color.color_id}`}
                      key={color.color_id}
                      className={cn(
                        "rounded-xl border p-3 transition",
                        active
                          ? "border-blue-400 bg-blue-50/70 ring-2 ring-blue-200"
                          : "border-slate-200 bg-white",
                      )}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const file = firstImageFile(event.dataTransfer.files);
                        if (!file) return;
                        void uploadDirect(color, file);
                      }}
                    >
                      <button
                        type="button"
                        className="flex w-full items-start gap-3 text-left"
                        onClick={() => setSelectedColorId(color.color_id)}
                      >
                        <span
                          className="mt-0.5 size-4 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: color.hex_code || "#CBD5E1" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900">
                            {color.color_name}{" "}
                            <span className="font-mono text-xs text-slate-500">
                              ({color.color_code})
                            </span>
                          </span>
                          <span
                            className={cn(
                              "mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                              hasImage
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {hasImage ? "มีรูปแยกสีแล้ว" : "ใช้รูปโปสเตอร์รวม"}
                          </span>
                        </span>
                        {hasImage && color.colorway_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- storage thumbnail
                          <img
                            src={color.colorway_image_url}
                            alt=""
                            className="size-12 rounded-md border border-slate-200 object-cover"
                          />
                        ) : null}
                      </button>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {hasImage ? (
                          confirmDeleteId === color.color_id ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => void removeColorImage(color)}
                              >
                                <Trash2 className="mr-1 size-3.5" />
                                ยืนยัน ใช้โปสเตอร์รวม
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                ยกเลิก
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => setConfirmDeleteId(color.color_id)}
                            >
                              ลบรูปสี
                            </Button>
                          )
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            วางไฟล์รูปสีนี้ลงการ์ดได้เลย
                          </span>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setSelectedColorId(color.color_id);
                            colorInputRef.current?.click();
                          }}
                        >
                          เลือกไฟล์รูปสี
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {(state?.colors.length ?? 0) === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    รุ่นนี้ยังไม่มีสีในสินค้าขาย
                  </p>
                ) : null}
              </div>
              <input
                ref={colorInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = firstImageFile(event.target.files);
                  event.target.value = "";
                  if (!file || !selected) return;
                  void uploadDirect(selected, file);
                }}
              />
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
