"use client";

import { useEffect, useRef, useState } from "react";

function stampFromIso(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("day")}/${pick("month")}/${Number(pick("year")) + 543} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

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
  liveCameraOnly: boolean;
  onCapture: (file: File, live: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  async function openCamera() {
    setBlocked(false);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      setStream(next);
      if (videoRef.current) videoRef.current.srcObject = next;
    } catch {
      setBlocked(true);
    }
  }

  async function shutter() {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const timed = await fetch("/api/fnb/server-time");
      const body = await timed.json() as { iso?: string };
      const iso = body.iso || new Date().toISOString();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const bar = Math.max(72, Math.round(canvas.height * 0.12));
      ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
      ctx.fillRect(0, canvas.height - bar, canvas.width, bar);
      ctx.fillStyle = "#ffffff";
      ctx.font = `${Math.max(16, Math.round(canvas.width / 46))}px sans-serif`;
      const line = `🕒 ${stampFromIso(iso)} เวลาเซิร์ฟเวอร์ | 📍 ${branchCode} (${stage}) | 👤 ${staffName} | 📌 ${taskTitle}`;
      ctx.fillText(line, 16, canvas.height - bar / 2, canvas.width - 32);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.72));
      if (!blob) return;
      onCapture(new File([blob], `live-${Date.now()}.webp`, { type: "image/webp" }), true);
      stream?.getTracks().forEach((track) => track.stop());
      setStream(null);
    } finally {
      setBusy(false);
    }
  }

  if (liveCameraOnly && blocked) {
    return (
      <label className="block text-sm">
        กล้องสดถูกบล็อก จึงเปิดกล้องถ่ายทันทีเท่านั้น
        <input
          className="mt-2 block w-full"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onCapture(file, true);
          }}
        />
      </label>
    );
  }

  if (!liveCameraOnly && !stream) {
    return (
      <div className="space-y-2">
        <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" onClick={() => void openCamera()}>เปิดกล้องสด</button>
        <label className="block text-sm">
          หรือเลือกรูปจากเครื่อง (ระบบจะกันภาพซ้ำ)
          <input className="mt-2 block w-full" type="file" accept="image/*" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onCapture(file, false);
          }} />
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stream ? <video ref={videoRef} className="max-h-72 w-full rounded-lg bg-black" autoPlay playsInline muted /> : null}
      {stream ? <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" disabled={busy} onClick={() => void shutter()}>{busy ? "กำลังประทับเวลา..." : "ถ่ายรูป"}</button> : <button type="button" className="rounded-md bg-red-700 px-3 py-2 text-sm text-white" onClick={() => void openCamera()}>เปิดกล้องหลัง</button>}
    </div>
  );
}
