import sharp from "sharp";

const MAX_SLIP_BYTES = 12 * 1024 * 1024;

export function isJpegBuffer(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF";
}

export function isAllowedSlipSourceUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (!parsed.pathname.includes("/storage/v1/object/")) return false;

  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  let configuredHost = "";
  if (configured) {
    try {
      configuredHost = new URL(configured).hostname;
    } catch {
      configuredHost = "";
    }
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const supabaseHost =
    parsed.hostname === configuredHost || parsed.hostname.endsWith(".supabase.co");
  if (!local && !supabaseHost) return false;
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && local;
}

export async function toJpegBuffer(buffer: Buffer): Promise<Buffer> {
  if (buffer.length === 0 || buffer.length > MAX_SLIP_BYTES) {
    throw new Error("ไฟล์สลิปว่างหรือใหญ่เกิน 12MB");
  }
  if (isPdfBuffer(buffer)) {
    throw new Error("ไฟล์ PDF ไม่ใช่รูปสลิป");
  }
  if (isJpegBuffer(buffer)) return buffer;
  return sharp(buffer, { failOn: "none", animated: false }).rotate().jpeg({ quality: 85 }).toBuffer();
}
