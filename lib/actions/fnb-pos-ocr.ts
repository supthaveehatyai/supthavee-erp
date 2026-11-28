"use server";

import { generateWithGeminiFallback, resolveGeminiApiKey } from "@/lib/ai/gemini-client";
import { OCR_MODEL_CASCADE } from "@/lib/ai/ocr-quota";
import { asRows, caught, num, result, text } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbPosFinancialSlip, FnbPosMenuSlipLine, FnbPosSlipExtract } from "@/types/fnb";

const FINANCIAL_PROMPT = [
  "อ่านสลิปความร้อน Lucky Cup รายงานยอดขายตามช่วงเวลา หรือรายงานยอดขาย แล้วตอบ JSON เท่านั้น",
  "คีย์: windowStart, windowEnd, isFullDayCumulative, orderCount, grossSales, discountTotal, promoCouponDiscount, deliveryPriceDiffDiscount, storeManualDiscount, cashAmount, thaiQrAmount, linemanAmount, grabfoodAmount, webAppAmount",
  "จับคู่ป้าย: 1. Cash=cashAmount, 2. THAI QR=thaiQrAmount, 3. LINEMAN=linemanAmount, 4. GRABFOOD=grabfoodAmount, 5. Web & App=webAppAmount",
  "จำนวนออเดอร์รวม=orderCount, ยอดขายรวม(หักบิลยกเลิก)=grossSales, ยอดรวมส่วนลดทั้งหมด=discountTotal",
  "ส่วนลดคูปองหรือโปรโมชั่นสมาชิก=promoCouponDiscount, ส่วนต่างราคาเดลิเวอรี=deliveryPriceDiffDiscount, ส่วนลดหน้าร้านอื่นๆ=storeManualDiscount",
  "เวลาเริ่มต้น=windowStart, เวลาสิ้นสุด=windowEnd",
  "ตั้ง isFullDayCumulative=true เมื่อเวลาเริ่มต้นขึ้นต้นด้วย 00:00:00 หรือหัวสลิปคือรายงานยอดขายแบบสะสมทั้งวัน",
  "ไม่พบตัวเลขให้ใส่ 0 และข้อความว่าง",
].join("\n");

const MENU_PROMPT = [
  "อ่านสลิป Lucky Cup รายงานยอดขายสินค้าที่จัดกลุ่มตามสินค้าและหมวดหมู่ แล้วตอบ JSON เท่านั้น",
  "รูปแบบ: { lines: [{ raw_menu_name, cup_size, qty_sold, sales_amount, pos_category_name }], totalQtyReported, totalAmountReported, isCategoryOnlyWarning }",
  "cup_size เป็น R หรือ L หรือ SINGLE เท่านั้น ถ้าไม่มีไซส์ให้ใส่ SINGLE",
  "ตัดเลขลำดับนำหน้าออก: 1.LUCKY สมูทตี้มัทฉะ -> LUCKY สมูทตี้มัทฉะ และ 28.0.5CF -> 0.5CF",
  "ห้ามใส่แถวยอดรวมหมวด: ยอดรวม(LUCKY สมูทตี้), ยอดรวม(กาแฟนมเข้มข้น), ยอดรวม(ชาผลไม้รสสดชื่น), ยอดรวม(กาแฟคลาสสิก), ยอดรวม(无分类), ยอดรวม(ขนม Lucky), ยอดรวม(กาแฟผลไม้), ยอดรวม(ไม่มีส่วนผสมของกาแฟ), ยอดรวม(อื่นๆ), จำนวนสินค้ารวม, จำนวนท็อปปิ้งรวม, ยอดรวมสินค้า",
  "เก็บเมนูที่อยู่ในหมวด 无分类 เช่น LUCKY พัฟครีมชีส และ LUCKY พัฟถั่วแดง เป็นรายการปกติ",
  "ถ้าภาพเป็นรายงานจัดกลุ่มตามสินค้าแบบสรุปหมวดอย่างเดียว ไม่มีชื่อเครื่องดื่มรายตัว ให้ตั้ง isCategoryOnlyWarning=true และ lines เป็น []",
].join("\n");

function emptyExtract(slipKind: "FINANCIAL_SUMMARY" | "MENU_SALES"): FnbPosSlipExtract {
  return {
    slipKind,
    financial: null,
    lines: [],
    totalQtyReported: 0,
    totalAmountReported: 0,
    isCategoryOnlyWarning: false,
  };
}

function asciiBranch(code: string): string {
  return code.replace(/[^A-Za-z0-9-]/g, "").slice(0, 16) || "BRANCH";
}

function jsonObject(raw: string): Record<string, unknown> {
  const fenced = raw.replace(/```json|```/gi, "");
  const match = fenced.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stripLineNo(name: string): string {
  return name.replace(/^\d+\s*\.\s*/, "").trim();
}

function isSubtotalRow(name: string): boolean {
  return name.startsWith("ยอดรวม") || name.startsWith("จำนวนสินค้า") || name.startsWith("จำนวนท็อปปิ้ง");
}

function cupSizeOf(value: string, name: string): string {
  const size = value.trim().toUpperCase();
  if (size === "R" || size === "L" || size === "SINGLE" || size === "16A" || size === "-") return size === "-" ? "SINGLE" : size;
  if (name.includes("(L)") || name.includes(" ใหญ่")) return "L";
  if (name.includes("(R)")) return "R";
  return "SINGLE";
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

async function imagePart(url: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  if (url.startsWith("data:image/")) {
    const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match?.[1] || !match[2]) return null;
    return { inlineData: { mimeType: match[1], data: match[2].replace(/\s/g, "") } };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("supabase.co")) return null;
  const response = await fetch(parsed);
  if (!response.ok) return null;
  const mime = (response.headers.get("content-type") || "image/jpeg").split(";")[0] || "image/jpeg";
  return { inlineData: { mimeType: mime, data: Buffer.from(await response.arrayBuffer()).toString("base64") } };
}

async function matchMenus(branchCode: string, lines: FnbPosMenuSlipLine[]): Promise<FnbPosMenuSlipLine[]> {
  if (!branchCode || lines.length === 0) return lines;
  const branch = await schemaAdmin().schema("fnb").from("branches").select("brand_code").eq("branch_code", branchCode).limit(1);
  const brand = text(asRows(branch.data)[0]?.brand_code);
  if (!brand) return lines;
  const listed = await schemaAdmin().schema("fnb").from("menus").select("id,menu_name_th,pos_menu_name,pos_aliases,cup_size,is_active").eq("brand_code", brand).eq("is_active", true).limit(800);
  const catalog = asRows(listed.data);
  return lines.map((line) => {
    const key = normalizeName(line.rawMenuName);
    const hit = catalog.find((row) => {
      const aliases = Array.isArray(row.pos_aliases) ? row.pos_aliases.map((alias) => text(alias)) : [];
      const sameName = normalizeName(text(row.menu_name_th)) === key || normalizeName(text(row.pos_menu_name)) === key || aliases.includes(line.rawMenuName);
      return sameName && (!text(row.cup_size) || text(row.cup_size) === line.cupSize || text(row.cup_size) === "SINGLE");
    }) ?? catalog.find((row) => normalizeName(text(row.menu_name_th)) === key || normalizeName(text(row.pos_menu_name)) === key);
    if (!hit) return { ...line, menuId: null, matchedName: "", isNewMenu: true };
    return { ...line, menuId: text(hit.id), matchedName: text(hit.menu_name_th), isNewMenu: false };
  });
}

export async function uploadFnbPosSlipAction(formData: FormData): Promise<FnbActionResult<{ url: string }>> {
  try {
    const branch = text(formData.get("branch_code"));
    const gate = await requireFnbStoreOperationAccess(branch);
    if (!gate.ok) return result({ url: "" }, gate.error);
    const file = formData.get("file");
    if (!(file instanceof File)) return result({ url: "" }, "ไม่พบรูปสลิป");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `fnb/${asciiBranch(branch)}/pos_${crypto.randomUUID()}.${ext}`;
    const uploaded = await schemaAdmin().storage.from("fnb_operations").upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (uploaded.error) return result({ url: "" }, uploaded.error.message || "อัปโหลดสลิปไม่สำเร็จ");
    return result({ url: schemaAdmin().storage.from("fnb_operations").getPublicUrl(path).data.publicUrl });
  } catch (error) {
    return caught({ url: "" }, error, "อัปโหลดสลิปไม่สำเร็จ");
  }
}

export async function extractFnbPosSlipOcrAction(input: {
  imageUrls: string[];
  slipKind: "FINANCIAL_SUMMARY" | "MENU_SALES";
  branchCode?: string;
}): Promise<FnbActionResult<FnbPosSlipExtract>> {
  const blank = emptyExtract(input.slipKind);
  try {
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result(blank, gate.error);
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return result(blank, "ยังไม่ได้ตั้งค่า Gemini");
    const images = (await Promise.all(input.imageUrls.filter(Boolean).slice(0, 4).map((url) => imagePart(url)))).filter((part) => part !== null);
    if (images.length === 0) return result(blank, "ไม่พบรูปสลิปที่อ่านได้");
    const generated = await generateWithGeminiFallback({
      apiKey,
      preferredModel: "gemini-3.7-flash",
      modelCascade: [...OCR_MODEL_CASCADE],
      parts: [{ text: input.slipKind === "MENU_SALES" ? MENU_PROMPT : FINANCIAL_PROMPT }, ...images],
    });
    const body = jsonObject(generated.text);
    if (input.slipKind === "FINANCIAL_SUMMARY") {
      const windowStart = text(body.windowStart);
      const financial: FnbPosFinancialSlip = {
        windowStart,
        windowEnd: text(body.windowEnd),
        isFullDayCumulative: body.isFullDayCumulative === true || windowStart.startsWith("00:00:00"),
        orderCount: num(body.orderCount),
        grossSales: num(body.grossSales),
        discountTotal: num(body.discountTotal),
        promoCouponDiscount: num(body.promoCouponDiscount),
        deliveryPriceDiffDiscount: num(body.deliveryPriceDiffDiscount),
        storeManualDiscount: num(body.storeManualDiscount),
        cashAmount: num(body.cashAmount),
        thaiQrAmount: num(body.thaiQrAmount),
        linemanAmount: num(body.linemanAmount),
        grabfoodAmount: num(body.grabfoodAmount),
        webAppAmount: num(body.webAppAmount),
      };
      return result({ ...blank, financial });
    }
    const warning = body.isCategoryOnlyWarning === true;
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    const lines: FnbPosMenuSlipLine[] = warning ? [] : rawLines.map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const name = stripLineNo(text(row.raw_menu_name));
      return {
        rawMenuName: name,
        cupSize: cupSizeOf(text(row.cup_size), name),
        qtySold: Math.max(0, Math.round(num(row.qty_sold))),
        salesAmount: num(row.sales_amount),
        posCategoryName: text(row.pos_category_name),
        menuId: null,
        matchedName: "",
        isNewMenu: true,
      };
    }).filter((line) => line.rawMenuName && line.qtySold > 0 && !isSubtotalRow(line.rawMenuName));
    const matched = await matchMenus(input.branchCode || "", lines);
    return result({
      ...blank,
      lines: matched,
      totalQtyReported: num(body.totalQtyReported),
      totalAmountReported: num(body.totalAmountReported),
      isCategoryOnlyWarning: warning,
    });
  } catch (error) {
    return caught(blank, error, "อ่านสลิป POS ไม่สำเร็จ");
  }
}

export async function listBranchMenusForSalesAction(branchCode: string): Promise<FnbActionResult<{ id: string; name: string; cupSize: string; pending: boolean }[]>> {
  try {
    const gate = await requireFnbStoreOperationAccess(branchCode);
    if (!gate.ok) return result([], gate.error);
    const branch = await schemaAdmin().schema("fnb").from("branches").select("brand_code").eq("branch_code", branchCode).limit(1);
    const brand = text(asRows(branch.data)[0]?.brand_code);
    if (!brand) return result([]);
    const listed = await schemaAdmin().schema("fnb").from("menus").select("id,menu_name_th,cup_size,is_bom_pending,is_active").eq("brand_code", brand).eq("is_active", true).order("menu_name_th", { ascending: true }).limit(800);
    if (listed.error) return result([]);
    return result(asRows(listed.data).map((row) => ({
      id: text(row.id),
      name: text(row.menu_name_th),
      cupSize: text(row.cup_size) || "R",
      pending: row.is_bom_pending === true,
    })));
  } catch (error) {
    return caught([], error, "อ่านเมนูไม่สำเร็จ");
  }
}
