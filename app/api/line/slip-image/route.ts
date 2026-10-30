import { NextResponse } from "next/server";
import { isAllowedSlipSourceUrl, toJpegBuffer } from "@/lib/line/slip-jpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  if (!isAllowedSlipSourceUrl(source)) {
    return new NextResponse("ลิงก์สลิปไม่ถูกต้อง", { status: 400 });
  }

  try {
    const upstream = await fetch(source, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      return new NextResponse("ดึงรูปสลิปไม่สำเร็จ", { status: 404 });
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    const jpeg = await toJpegBuffer(bytes);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": download ? 'attachment; filename="payment-slip.jpg"' : "inline",
      },
    });
  } catch {
    return new NextResponse("แปลงรูปสลิปเป็น JPEG ไม่สำเร็จ", { status: 422 });
  }
}
