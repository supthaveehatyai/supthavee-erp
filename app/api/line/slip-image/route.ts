import { NextResponse } from "next/server";
import { isAllowedSlipSourceUrl } from "@/lib/line/slip-jpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const targetUrl = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  if (!isAllowedSlipSourceUrl(targetUrl)) {
    return new NextResponse("ลิงก์สลิปไม่ถูกต้อง", { status: 400 });
  }

  try {
    const upstream = await fetch(targetUrl, { cache: "no-store" });
    if (!upstream.ok) {
      return new NextResponse("ดึงรูปสลิปไม่สำเร็จ", { status: 404 });
    }
    const bytes = await upstream.arrayBuffer();
    const upstreamContentType = upstream.headers.get("content-type")?.split(";")[0]?.trim() || "";
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": upstreamContentType || "image/jpeg",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition": download ? 'attachment; filename="payment-slip.jpg"' : "inline",
      },
    });
  } catch {
    return new NextResponse("ดึงรูปสลิปไม่สำเร็จ", { status: 422 });
  }
}
