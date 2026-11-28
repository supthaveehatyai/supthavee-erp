"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

const FIVE_MINUTES_MS = 300_000;

export function LiveWatermarkCamera({
  branchCode,
  stage,
  staffName,
  taskTitle,
  liveCameraOnly,
  onCapture,
}: {
  branchCode: string;
  stage: string;
  staffName: string;
  taskTitle: string;
  liveCameraOnly?: boolean;
  onCapture: (file: File, liveCapture: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || !isCameraModalOpen) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [stream, isCameraModalOpen]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function stampFile(file: File) {
    const bitmap = await decodeImage(file);
    const sourceWidth = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
    const sourceHeight = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
    const fitted = fitBox(sourceWidth, sourceHeight, 1600);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("เตรียมภาพไม่สำเร็จ");
    ctx.drawImage(bitmap, 0, 0, fitted.width, fitted.height);
    if ("close" in bitmap) bitmap.close();
    const stamped = await stampClock();
    const label = `🕒 ${stamped} | 📍 ${branchCode} | 👤 ${staffName || "-"} | 📌 ${taskTitle}`;
    const bar = Math.max(36, Math.round(fitted.width * 0.045));
    ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
    ctx.fillRect(0, fitted.height - bar, fitted.width, bar);
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.max(12, Math.round(bar * 0.38))}px sans-serif`;
    ctx.fillText(label, 12, fitted.height - Math.round(bar * 0.32), fitted.width - 24);
    const encoded = await canvasBlob(canvas);
    const named = new File([encoded.blob], `live-${stage.toLowerCase()}-${Date.now()}.${encoded.ext}`, { type: encoded.type });
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(named);
    });
    onCapture(named, true);
  }

  async function handleNativeCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const assisted = document.documentElement.dataset.fnbAssisted === "1";
    if (liveCameraOnly && !assisted && file.lastModified > 0 && Date.now() - file.lastModified > FIVE_MINUTES_MS) {
      toast.error("กรุณาถ่ายรูปสดจากกล้อง ณ ปัจจุบัน ห้ามเลือกรูปเก่าในเครื่อง");
      return;
    }
    setBusy(true);
    try {
      await stampFile(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ประทับรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function openWebCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("เบราว์เซอร์นี้ไม่เปิดกล้องบนเว็บได้ กรุณาใช้ปุ่มถ่ายรูปสด");
      return;
    }
    setIsCameraModalOpen(true);
    try {
      let next: MediaStream;
      try {
        next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch {
        next = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      setStream(next);
    } catch {
      setIsCameraModalOpen(false);
      toast.error("ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตกล้องในการตั้งค่า แล้วลองใหม่");
    }
  }

  function closeWebCamera() {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setIsCameraModalOpen(false);
  }

  async function shootWeb() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    const fitted = fitBox(video.videoWidth, video.videoHeight, 1600);
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, fitted.width, fitted.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return;
    closeWebCamera();
    setBusy(true);
    try {
      await stampFile(new File([blob], "webrtc.jpg", { type: "image/jpeg", lastModified: Date.now() }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ประทับรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-3 py-3 text-center text-sm font-semibold text-white">
        {busy ? "กำลังประทับเวลา..." : "📸 เปิดกล้องถ่ายรูปสด"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => { void handleNativeCapture(event); }}
        />
      </label>
      <button type="button" className="text-xs font-semibold text-slate-600 underline" onClick={() => { void openWebCamera(); }}>
        🎥 กล้องสดบนเว็บ
      </button>
      {previewUrl ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={taskTitle} className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
          <button
            type="button"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            onClick={() => setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ""; })}
          >
            🗑️ ลบรูปถ่ายใหม่
          </button>
        </div>
      ) : null}
      {isCameraModalOpen ? (
        <div className="space-y-2 rounded-xl bg-black p-2">
          <video ref={videoRef} autoPlay playsInline muted className="max-h-80 w-full rounded-lg bg-black" />
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-white px-3 py-2 text-sm font-semibold" onClick={() => { void shootWeb(); }}>ถ่าย</button>
            <button type="button" className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white" onClick={closeWebCamera}>ปิด</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fitBox(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file);
  } catch {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("อ่านรูปไม่สำเร็จ"));
      };
      img.src = url;
    });
  }
}

async function stampClock() {
  let iso = "";
  try {
    const timed = await fetch("/api/fnb/server-time", { cache: "no-store" });
    const body = await timed.json() as { iso?: string };
    iso = body.iso ?? "";
  } catch {
    iso = "";
  }
  const date = new Date(iso || Date.now());
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<{ blob: Blob; type: string; ext: string }> {
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/webp", 0.82));
  if (webp && webp.size > 0 && webp.type.includes("webp")) return { blob: webp, type: "image/webp", ext: "webp" };
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82));
  if (!jpeg) throw new Error("บันทึกรูปไม่สำเร็จ");
  return { blob: jpeg, type: "image/jpeg", ext: "jpg" };
}
