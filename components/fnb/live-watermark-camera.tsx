"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

const FIVE_MINUTES_MS = 300_000;
let clockOffsetMs = 0;
let clockLoaded = false;

function rememberClock(iso: string) {
  const server = Date.parse(iso);
  if (Number.isFinite(server)) clockOffsetMs = server - Date.now();
  clockLoaded = true;
}

async function uploadJpeg(file: Blob, branchCode: string, signal: AbortSignal): Promise<string> {
  const body = new FormData();
  body.set("file", file, "capture.jpg");
  body.set("branchCode", branchCode);
  const response = await fetch("/api/fnb/upload-photo", { method: "POST", body, signal });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; publicUrl?: string; error?: string; serverTimeISO?: string };
  if (data.serverTimeISO) rememberClock(data.serverTimeISO);
  if (!response.ok || !data.ok || !data.publicUrl) throw new Error(data.error || "อัปโหลดรูปไม่สำเร็จ");
  return data.publicUrl;
}

export function LiveWatermarkCamera({
  branchCode,
  stage,
  staffName,
  taskTitle,
  liveCameraOnly,
  onUploaded,
  onCapture,
}: {
  branchCode: string;
  stage: string;
  staffName: string;
  taskTitle: string;
  liveCameraOnly?: boolean;
  onUploaded?: (publicUrl: string) => void;
  onCapture?: (file: File, liveCapture: boolean) => void;
}) {
  const inputId = useId();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadState, setUploadState] = useState<"IDLE" | "UPLOADING" | "SAVED" | "FAILED_RETRY">("IDLE");
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (clockLoaded) return;
    void fetch("/api/fnb/server-time", { cache: "no-store" }).then((response) => response.json()).then((body: { iso?: string }) => {
      if (body.iso) rememberClock(body.iso);
    }).catch(() => { clockLoaded = true; });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || !isCameraModalOpen) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [stream, isCameraModalOpen]);

  useEffect(() => () => { stream?.getTracks().forEach((track) => track.stop()); }, [stream]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function send(blob: Blob) {
    setUploadState("UPLOADING");
    setError("");
    const attempt = async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 12_000);
      try {
        return await uploadJpeg(blob, branchCode, controller.signal);
      } finally {
        window.clearTimeout(timer);
      }
    };
    try {
      let url = "";
      try {
        url = await attempt();
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        url = await attempt();
      }
      setPendingBlob(null);
      setUploadState("SAVED");
      onUploaded?.(url);
      if (!onUploaded && onCapture) onCapture(new File([blob], `live-${stage}.jpg`, { type: "image/jpeg" }), true);
    } catch (reason) {
      setPendingBlob(blob);
      setUploadState("FAILED_RETRY");
      setError(reason instanceof Error ? reason.message : "เน็ตสะดุด");
    }
  }

  async function stampAndSend(file: File) {
    const blobUrl = URL.createObjectURL(file);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("อ่านรูปไม่สำเร็จ"));
        img.src = blobUrl;
      });
      const fitted = fitBox(image.naturalWidth, image.naturalHeight, 1280);
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      if (!ctx) throw new Error("เตรียมภาพไม่สำเร็จ");
      ctx.drawImage(image, 0, 0, fitted.width, fitted.height);
      const stamped = new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(Date.now() + clockOffsetMs));
      const label = `🕒 ${stamped} | 📍 ${branchCode} | 👤 ${staffName || "-"} | 📌 ${taskTitle}`;
      const bar = Math.max(36, Math.round(fitted.width * 0.045));
      ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
      ctx.fillRect(0, fitted.height - bar, fitted.width, bar);
      ctx.fillStyle = "#ffffff";
      ctx.font = `${Math.max(12, Math.round(bar * 0.38))}px sans-serif`;
      ctx.fillText(label, 12, fitted.height - Math.round(bar * 0.32), fitted.width - 24);
      const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("บันทึกรูปไม่สำเร็จ")), "image/jpeg", 0.8));
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(jpeg);
      });
      await send(jpeg);
    } finally {
      URL.revokeObjectURL(blobUrl);
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  async function handleNativeCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const assisted = document.documentElement.dataset.fnbAssisted === "1";
    if (liveCameraOnly && !assisted && file.lastModified > 0 && Date.now() - file.lastModified > FIVE_MINUTES_MS) {
      setError("กรุณาถ่ายรูปสดจากกล้อง ณ ปัจจุบัน ห้ามเลือกรูปเก่าในเครื่อง");
      return;
    }
    try {
      await stampAndSend(file);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ประทับรูปไม่สำเร็จ");
      setUploadState("FAILED_RETRY");
    }
  }

  async function openWebCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("เบราว์เซอร์นี้ไม่เปิดกล้องบนเว็บได้ กรุณาใช้ปุ่มถ่ายรูปสด");
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
      setError("ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตกล้องในการตั้งค่า แล้วลองใหม่");
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
    const ctx = canvas.getContext("2d");
    try {
      const fitted = fitBox(video.videoWidth, video.videoHeight, 1280);
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, fitted.width, fitted.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      closeWebCamera();
      if (!blob) return;
      await stampAndSend(new File([blob], "webrtc.jpg", { type: "image/jpeg", lastModified: Date.now() }));
    } finally {
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-3 py-3 text-center text-sm font-semibold text-white">
        {uploadState === "UPLOADING" ? "⏳ กำลังบันทึกรูปจุดนี้..." : "📸 เปิดกล้องถ่ายรูปสด"}
        <input id={inputId} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { void handleNativeCapture(event); }} />
      </label>
      <button type="button" className="text-xs font-semibold text-slate-600 underline" onClick={() => { void openWebCamera(); }}>🎥 กล้องสดบนเว็บ</button>
      {uploadState === "SAVED" ? <p className="text-xs font-medium text-emerald-700">☁️ อัปโหลดรูปนี้แล้ว</p> : null}
      {uploadState === "FAILED_RETRY" && pendingBlob ? (
        <button type="button" className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950" onClick={() => { void send(pendingBlob); }}>⚠️ เน็ตสะดุด — แตะส่งรูปนี้ซ้ำ (ไม่ต้องถ่ายใหม่!)</button>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {previewUrl ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={taskTitle} className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
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
