const MAX_EDGE = 1920;
const QUALITY = 0.82;

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isRaster(file: File): boolean {
  return (
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp" ||
    /\.(jpe?g|png|webp)$/i.test(file.name)
  );
}

function outputType(file: File): string {
  if (file.type === "image/png") return "image/jpeg";
  if (file.type === "image/webp") return "image/webp";
  return "image/jpeg";
}

function extensionFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "application/pdf") return "pdf";
  return "jpg";
}

/**
 * ย่อรูปบิลฝั่งเบราว์เซอร์ ด้านยาวสุดไม่เกิน 1920px ที่ quality 0.82
 * PDF ส่งต่อตรงโดยไม่บีบอัด
 */
export async function compressBillFile(file: File): Promise<File> {
  if (isPdf(file)) return file;
  if (!isRaster(file)) {
    throw new Error("รองรับเฉพาะ JPEG, PNG, WebP หรือ PDF");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("บีบอัดรูปบิลไม่สำเร็จ");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mime = outputType(file);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("บีบอัดรูปบิลไม่สำเร็จ"));
      },
      mime,
      QUALITY,
    );
  });

  const base = file.name.replace(/\.[^.]+$/, "") || "bill";
  return new File([blob], `${base}.${extensionFor(mime)}`, {
    type: mime,
    lastModified: Date.now(),
  });
}
