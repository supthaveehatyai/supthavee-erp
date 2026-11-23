"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  clearModelVisualSlotAction,
  copyMainImageToCatalogSlotAction,
  deleteColorwayImageAction,
  getModelCropperStateAction,
  updateModelCatalogMetaAction,
  uploadColorwayCroppedImageAction,
  uploadModelVisualSlotAction,
} from "@/lib/actions/colorway-catalog-actions";
import { compressCatalogClarityImage, compressImage } from "@/lib/utils/image-compression";
import type {
  ModelColorCropperItem,
  ModelColorCropperState,
  ModelVisualSlot,
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

type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const MIN_FREE = 0.04;
const SIZE_CHART_FRAME: CropNorm = { x: 0.38, y: 0.72, w: 0.6, h: 0.24 };
const CATALOG_EXPORT_EDGE = 2048;

const CROP_HANDLES: { id: CropHandle; className: string; cursor: string; wide: boolean }[] = [
  { id: "nw", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "cursor-nw-resize", wide: false },
  { id: "n", className: "left-1/2 top-0 h-2.5 w-7 -translate-x-1/2 -translate-y-1/2", cursor: "cursor-ns-resize", wide: true },
  { id: "ne", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2", cursor: "cursor-nesw-resize", wide: false },
  { id: "e", className: "right-0 top-1/2 h-7 w-2.5 translate-x-1/2 -translate-y-1/2", cursor: "cursor-ew-resize", wide: true },
  { id: "se", className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2", cursor: "cursor-nwse-resize", wide: false },
  { id: "s", className: "bottom-0 left-1/2 h-2.5 w-7 -translate-x-1/2 translate-y-1/2", cursor: "cursor-ns-resize", wide: true },
  { id: "sw", className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2", cursor: "cursor-nesw-resize", wide: false },
  { id: "w", className: "left-0 top-1/2 h-7 w-2.5 -translate-x-1/2 -translate-y-1/2", cursor: "cursor-ew-resize", wide: true },
];

function touchesWest(handle: CropHandle): boolean {
  return handle === "w" || handle === "nw" || handle === "sw";
}
function touchesEast(handle: CropHandle): boolean {
  return handle === "e" || handle === "ne" || handle === "se";
}
function touchesNorth(handle: CropHandle): boolean {
  return handle === "n" || handle === "nw" || handle === "ne";
}
function touchesSouth(handle: CropHandle): boolean {
  return handle === "s" || handle === "sw" || handle === "se";
}

/** Free mode: each axis clamps on its own, so a box flush with the bottom can still widen to 100%. */
function resizeFree(origin: CropNorm, dx: number, dy: number, handle: CropHandle): CropNorm {
  const right = origin.x + origin.w;
  const bottom = origin.y + origin.h;
  let x = origin.x;
  let y = origin.y;
  let w = origin.w;
  let h = origin.h;

  if (touchesWest(handle)) {
    x = clamp01(origin.x + dx, 0, right - MIN_FREE);
    w = right - x;
  } else if (touchesEast(handle)) {
    w = clamp01(origin.w + dx, MIN_FREE, 1 - origin.x);
  }

  if (touchesNorth(handle)) {
    y = clamp01(origin.y + dy, 0, bottom - MIN_FREE);
    h = bottom - y;
  } else if (touchesSouth(handle)) {
    h = clamp01(origin.h + dy, MIN_FREE, 1 - origin.y);
  }

  return { x, y, w, h };
}

function resizeLocked(
  origin: CropNorm,
  dx: number,
  dy: number,
  handle: CropHandle,
  ratio: number,
  displayRatio: number,
): CropNorm {
  const free = resizeFree(origin, dx, dy, handle);
  const driveVertical = handle === "n" || handle === "s";
  let w = free.w;
  let h = free.h;
  if (driveVertical) w = (h * ratio) / Math.max(displayRatio, 0.01);
  else h = (w * displayRatio) / ratio;
  let x = touchesWest(handle) ? origin.x + origin.w - w : origin.x;
  let y = touchesNorth(handle) ? origin.y + origin.h - h : origin.y;
  if (x < 0) {
    w += x;
    x = 0;
    h = (w * displayRatio) / ratio;
    if (touchesNorth(handle)) y = origin.y + origin.h - h;
  }
  if (y < 0) {
    h += y;
    y = 0;
    w = (h * ratio) / Math.max(displayRatio, 0.01);
    if (touchesWest(handle)) x = origin.x + origin.w - w;
  }
  if (x + w > 1) {
    w = 1 - x;
    h = (w * displayRatio) / ratio;
    if (touchesNorth(handle)) y = origin.y + origin.h - h;
  }
  if (y + h > 1) {
    h = 1 - Math.max(y, 0);
    w = (h * ratio) / Math.max(displayRatio, 0.01);
    if (touchesWest(handle)) x = origin.x + origin.w - w;
  }
  return clampCrop({ x, y, w, h });
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

function VisualSlotCard({
  title,
  url,
  busy,
  uploadLabel,
  cropLabel,
  copyLabel,
  onUpload,
  onCrop,
  onCopy,
  onClear,
  onUse,
}: {
  title: string;
  url?: string | null;
  busy: boolean;
  uploadLabel: string;
  cropLabel?: string;
  copyLabel?: string;
  onUpload: () => void;
  onCrop?: () => void;
  onCopy?: () => void;
  onClear?: () => void;
  onUse?: () => void;
}) {
  const src = (url ?? "").trim();
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2">
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      <button
        type="button"
        className="mt-2 flex h-20 w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-200 bg-slate-50"
        onClick={src && onUse ? onUse : undefined}
        disabled={!src || !onUse}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- optional model visual
          <img src={src} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="text-[11px] text-slate-400">ยังไม่มี (ไม่บังคับ)</span>
        )}
      </button>
      <div className="mt-2 flex flex-wrap gap-1">
        {onCrop && cropLabel ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onCrop}>
            {cropLabel}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onUpload}>
          {uploadLabel}
        </Button>
        {onCopy && copyLabel ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCopy}>
            {copyLabel}
          </Button>
        ) : null}
        {onClear ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClear}>
            ลบ
          </Button>
        ) : null}
      </div>
    </div>
  );
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
  const slotInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<ModelVisualSlot>("MAIN");
  const cropRef = useRef<CropNorm>({ x: 0.15, y: 0.08, w: 0.7, h: 0.84 });
  const dragRef = useRef<{
    mode: "move" | "resize" | "marquee";
    handle: CropHandle | null;
    startX: number;
    startY: number;
    startNormX: number;
    startNormY: number;
    origin: CropNorm;
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
  const [catalogName, setCatalogName] = useState("");
  const [canvasOverride, setCanvasOverride] = useState<string | null>(null);

  function updateCrop(next: CropNorm) {
    cropRef.current = next;
    setCrop(next);
  }

  const posterUrl = (state?.model.main_image_url || state?.model.poster_image_url || "").trim();
  const imageSrc = localPosterUrl || canvasOverride || (!cdnFailed ? posterUrl : "");
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
    setCanvasOverride(null);
    setCatalogName("");
    void getModelCropperStateAction(modelId).then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.error || !result.state) {
        setLoadError(result.error ?? "โหลดสีของรุ่นนี้ไม่สำเร็จ");
        return;
      }
      setState(result.state);
      setCatalogName(result.state.model.catalog_name ?? "");
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

  function normFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp01((clientX - rect.left) / rect.width, 0, 1),
      y: clamp01((clientY - rect.top) / rect.height, 0, 1),
    };
  }

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.mode === "marquee") {
        const point = normFromClient(event.clientX, event.clientY);
        if (!point) return;
        const x = Math.min(drag.startNormX, point.x);
        const y = Math.min(drag.startNormY, point.y);
        const next = {
          x,
          y,
          w: Math.max(Math.min(Math.abs(point.x - drag.startNormX), 1 - x), 0.01),
          h: Math.max(Math.min(Math.abs(point.y - drag.startNormY), 1 - y), 0.01),
        };
        cropRef.current = next;
        setCrop(next);
        return;
      }
      const dx = (event.clientX - drag.startX) / Math.max(drag.width, 1);
      const dy = (event.clientY - drag.startY) / Math.max(drag.height, 1);
      const next =
        drag.mode === "move"
          ? clampCrop({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy })
          : drag.handle
            ? aspect === "free"
              ? resizeFree(drag.origin, dx, dy, drag.handle)
              : resizeLocked(
                  drag.origin,
                  dx,
                  dy,
                  drag.handle,
                  ASPECT_RATIO[aspect],
                  drag.width / Math.max(drag.height, 1),
                )
            : drag.origin;
      cropRef.current = next;
      setCrop(next);
    }
    function onUp(event: PointerEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.mode !== "marquee") return;
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
      const current = cropRef.current;
      if (!moved || (current.w < 0.03 && current.h < 0.03)) {
        cropRef.current = drag.origin;
        setCrop(drag.origin);
        return;
      }
      setAspect("free");
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [aspect]);

  function startDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    mode: "move" | "resize",
    handle: CropHandle | null = null,
  ) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startNormX: 0,
      startNormY: 0,
      origin: cropRef.current,
      width: innerWidth,
      height: innerHeight,
    };
  }

  function startMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const point = normFromClient(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    dragRef.current = {
      mode: "marquee",
      handle: null,
      startX: event.clientX,
      startY: event.clientY,
      startNormX: point.x,
      startNormY: point.y,
      origin: cropRef.current,
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
    setCatalogName(result.state.model.catalog_name ?? "");
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
        localPosterUrl ? "" : canvasOverride || posterUrl,
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
    const file = await renderCropFile(`${selected.color_code || "color"}.webp`);
    if (!file) return;
    await submitColorFile(selected, file, {
      x: crop.x,
      y: crop.y,
      w: crop.w,
      h: crop.h,
      aspect,
      source: localPosterUrl ? "local_poster" : "cdn_poster",
    });
  }

  async function uploadDirect(color: ModelColorCropperItem, file: File) {
    setSelectedColorId(color.color_id);
    await submitColorFile(color, file, { source: "direct_upload" });
  }

  async function renderCropFile(filename: string, maxDimension = 0): Promise<File | null> {
    const img = imgRef.current;
    if (!img || natural.w <= 0 || !imageSrc) {
      toast.error("ยังไม่มีรูปบนผืนตัด — เลือกไฟล์จากเครื่อง");
      return null;
    }
    const sx = Math.round(crop.x * natural.w);
    const sy = Math.round(crop.y * natural.h);
    const sw = Math.max(1, Math.round(crop.w * natural.w));
    const sh = Math.max(1, Math.round(crop.h * natural.h));
    const edge = Math.max(sw, sh);
    const scale = maxDimension > 0 && edge > maxDimension ? maxDimension / edge : 1;
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("เบราว์เซอร์นี้ตัดรูปไม่ได้");
      return null;
    }
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
          canvas.toBlob((file) => resolve(file), "image/webp", 0.92);
        } catch (err) {
          reject(err);
        }
      });
      if (!blob) throw new Error("อ่านพิกเซลจากรูปนี้ไม่ได้");
      return new File([blob], filename, { type: "image/webp" });
    } catch {
      toast.error("อ่านพิกเซลจากรูป CDN ไม่ได้ — เลือกไฟล์จากเครื่องแล้วตัดอีกครั้ง");
      return null;
    }
  }

  async function uploadSlotFile(slot: ModelVisualSlot, file: File, success: string) {
    setBusy(true);
    try {
      let compressed: File;
      try {
        compressed =
          slot === "CATALOG" || slot === "SIZE_CHART"
            ? await compressCatalogClarityImage(file)
            : await compressImage(file);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "บีบอัดรูปไม่สำเร็จ");
        return;
      }
      const formData = new FormData();
      formData.set("file", compressed);
      formData.set("modelId", state?.model.model_id || modelId);
      formData.set("modelCode", state?.model.model_code || modelCode);
      formData.set("slot", slot);
      const result = await uploadModelVisualSlotAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (slot === "CATALOG") {
        replaceLocalPoster(null);
        setCanvasOverride(result.imageUrl);
        setCdnFailed(false);
      }
      if (slot === "MAIN") setCanvasOverride(null);
      toast.success(success);
      onSaved?.();
      await refreshColors();
    } finally {
      setBusy(false);
    }
  }

  async function cropSlot(slot: ModelVisualSlot, success: string) {
    const clarity = slot === "CATALOG" || slot === "SIZE_CHART";
    const file = await renderCropFile(
      slot === "SIZE_CHART" ? "sizechart.webp" : slot === "CATALOG" ? "catalog.webp" : "main.webp",
      clarity ? CATALOG_EXPORT_EDGE : 0,
    );
    if (!file) return;
    await uploadSlotFile(slot, file, success);
  }

  async function saveCatalogName() {
    setBusy(true);
    try {
      const result = await updateModelCatalogMetaAction(
        state?.model.model_id || modelId,
        catalogName,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCatalogName(result.catalogName ?? "");
      toast.success(result.catalogName ? "บันทึกชื่อ Catalog แล้ว" : "ล้างชื่อ Catalog แล้ว");
      onSaved?.();
      await refreshColors();
    } finally {
      setBusy(false);
    }
  }

  async function copyMainToCatalog() {
    const main = (state?.model.main_image_url || "").trim();
    if (!main) {
      toast.error("ยังไม่มีรูปหลักของรุ่น");
      return;
    }
    setBusy(true);
    try {
      const result = await copyMainImageToCatalogSlotAction(
        state?.model.model_id || modelId,
        main,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.imageUrl) {
        replaceLocalPoster(null);
        setCanvasOverride(result.imageUrl);
        setCdnFailed(false);
      }
      toast.success("ใช้รูปหลักเป็นใบ Catalog แล้ว");
      onSaved?.();
      await refreshColors();
    } finally {
      setBusy(false);
    }
  }

  async function clearSlot(slot: ModelVisualSlot) {
    setBusy(true);
    try {
      const result = await clearModelVisualSlotAction(
        state?.model.model_id || modelId,
        slot,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (slot === "CATALOG") setCanvasOverride(null);
      toast.success("ลบรูปช่องนี้แล้ว");
      onSaved?.();
      await refreshColors();
    } finally {
      setBusy(false);
    }
  }

  function useCatalogOnCanvas() {
    const url = (state?.model.catalog_image_url || "").trim();
    if (!url) return;
    replaceLocalPoster(null);
    setCanvasOverride(url);
    setCdnFailed(false);
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
          <div className="flex min-h-0 flex-1 flex-col">
            <details open className="border-b border-slate-100 bg-slate-50 px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                ข้อมูล Catalog & รูปส่วนกลางของรุ่น (ไม่บังคับ)
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={catalogName}
                    onChange={(event) => setCatalogName(event.target.value)}
                    placeholder="ชื่อ Catalog (ไม่บังคับ)"
                    aria-label="ชื่อ Catalog"
                    className="h-9 min-w-[16rem] flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void saveCatalogName()}
                  >
                    บันทึกชื่อ
                  </Button>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <VisualSlotCard
                    title="ใบ Catalog รวม"
                    url={state?.model.catalog_image_url}
                    busy={busy}
                    onUse={state?.model.catalog_image_url ? useCatalogOnCanvas : undefined}
                    onUpload={() => {
                      pendingSlotRef.current = "CATALOG";
                      slotInputRef.current?.click();
                    }}
                    onCopy={
                      !state?.model.catalog_image_url && state?.model.main_image_url
                        ? () => void copyMainToCatalog()
                        : undefined
                    }
                    onClear={
                      state?.model.catalog_image_url
                        ? () => void clearSlot("CATALOG")
                        : undefined
                    }
                    uploadLabel="อัปโหลดใบ Catalog"
                    copyLabel="ดึงจากรูปหลักรุ่น"
                  />
                  <VisualSlotCard
                    title="รูปหลักของรุ่น"
                    url={state?.model.main_image_url}
                    busy={busy}
                    onCrop={() => void cropSlot("MAIN", "บันทึกรูปหลักจากกรอบแล้ว")}
                    cropLabel="✂️ ตัดจากกรอบเป็นรูปหลัก"
                    onUpload={() => {
                      pendingSlotRef.current = "MAIN";
                      slotInputRef.current?.click();
                    }}
                    onClear={
                      state?.model.main_image_url ? () => void clearSlot("MAIN") : undefined
                    }
                    uploadLabel="อัปโหลดไฟล์"
                  />
                  <VisualSlotCard
                    title="ตารางขนาดสินค้า"
                    url={state?.model.size_chart_image_url}
                    busy={busy}
                    onCrop={() => void cropSlot("SIZE_CHART", "บันทึกตารางขนาดจากกรอบแล้ว")}
                    cropLabel="✂️ ตัดจากกรอบเป็นตารางขนาด"
                    onUpload={() => {
                      pendingSlotRef.current = "SIZE_CHART";
                      slotInputRef.current?.click();
                    }}
                    onClear={
                      state?.model.size_chart_image_url
                        ? () => void clearSlot("SIZE_CHART")
                        : undefined
                    }
                    uploadLabel="อัปโหลดไฟล์"
                  />
                </div>
              </div>
              <input
                ref={slotInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = firstImageFile(event.target.files);
                  event.target.value = "";
                  if (!file) return;
                  const slot = pendingSlotRef.current;
                  const success =
                    slot === "CATALOG"
                      ? "อัปโหลดใบ Catalog แล้ว"
                      : slot === "SIZE_CHART"
                        ? "อัปโหลดตารางขนาดแล้ว"
                        : "อัปโหลดรูปหลักแล้ว";
                  void uploadSlotFile(slot, file, success);
                }}
              />
            </details>
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setAspect("free");
                    updateCrop(SIZE_CHART_FRAME);
                  }}
                >
                  📏 กรอบตารางขนาด (Free)
                </Button>
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
                  <div
                    className="relative"
                    style={{ width: innerWidth, height: innerHeight }}
                    onPointerDown={startMarquee}
                  >
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
                      {CROP_HANDLES.map((handle) => (
                        <div
                          key={handle.id}
                          aria-label={`ปรับกรอบ ${handle.id}`}
                          className={cn(
                            "absolute z-10 border border-slate-400 bg-white shadow-sm",
                            handle.cursor,
                            handle.className,
                            handle.wide ? "" : "size-3.5 rounded-sm",
                          )}
                          onPointerDown={(event) => startDrag(event, "resize", handle.id)}
                        />
                      ))}
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
                    onClick={() => void uploadSlotFile("MAIN", localPosterFile, "บันทึกรูปหลักของรุ่นแล้ว")}
                  >
                    บันทึกไฟล์นี้เป็นรูปหลัก
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
