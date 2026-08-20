/**
 * Global client-side image compression (WebP).
 * CLIENT COMPONENTS ONLY — uses browser-image-compression + Web Worker.
 *
 * Defaults (ERP Storage budget):
 *   maxSizeMB: 0.5 · maxWidthOrHeight: 1200 · useWebWorker: true · WebP
 */

import imageCompression from "browser-image-compression";

const DEFAULT_OPTIONS: Parameters<typeof imageCompression>[1] = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1200,
  useWebWorker: true,
  fileType: "image/webp",
};

/** Rename / coerce to `.webp` while keeping a safe basename. */
function toWebpFile(file: File, originalName: string): File {
  const base =
    originalName.replace(/\.[^.]+$/, "").trim() || "image";
  const safeBase = base.replace(/[^\w.-]+/g, "_").slice(0, 80) || "image";
  return new File([file], `${safeBase}.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}

function isCompressibleImage(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith("image/")) return false;
  // SVG is vector — compression library is raster-oriented
  if (mime === "image/svg+xml") return false;
  return true;
}

const OCR_OPTIONS: Parameters<typeof imageCompression>[1] = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1600,
  useWebWorker: true,
  fileType: "image/webp",
};

/**
 * Compress receipt images before Expense OCR Server Action upload.
 * Targets ≤ 0.5 MB / 1600px edge to stay under Vercel payload limits.
 */
export async function compressImageForOcr(file: File): Promise<File> {
  if (!file || !(file instanceof File) || file.size <= 0) {
    return file;
  }

  if (!isCompressibleImage(file)) {
    return file;
  }

  const compressed = await imageCompression(file, OCR_OPTIONS);
  return toWebpFile(compressed, file.name);
}

/**
 * Compress a raster image to WebP (≤ 0.5MB, max edge 1200px).
 * Non-images (e.g. PDF) and SVG are returned unchanged.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file || !(file instanceof File) || file.size <= 0) {
    return file;
  }

  if (!isCompressibleImage(file)) {
    return file;
  }

  const compressed = await imageCompression(file, DEFAULT_OPTIONS);
  return toWebpFile(compressed, file.name);
}

/**
 * Compress many files in sequence (preserves order).
 * Failures surface as thrown errors — callers should toast / abort upload.
 */
export async function compressImages(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    out.push(await compressImage(file));
  }
  return out;
}
