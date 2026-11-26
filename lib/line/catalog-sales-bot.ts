import { createClient } from "@/lib/supabase/server-admin";
import { replyLineMessages } from "@/lib/line/line-oa";
import { replySupthaveeBankQr } from "@/lib/line/bank-qr-reply";

const COMMAND_RE =
  /^#(เลขบัญชี|บัญชี|qr|รูป|พร้อมส่ง|สต็อก|สต๊อก|แคตตาล็อก|แคตตาล๊อก|catalog|เช็ค|เช็ก|ไซส์|ตารางไซส์|ตารางขนาด|size|คู่มือ|คำสั่ง|help)\s*(.*)$/i;
const FLEX_LABEL_LIMIT = 20;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const CATALOG_BUTTON_LABEL = "📋 ใบ Catalog";
const SIZE_BUTTON_LABEL = "📏 ตารางขนาด";

const USAGE_GUIDE = [
  "ส่งให้ลูกค้า (ซ่อนจำนวนสต็อก):",
  "#รูป เสื้อกีฬา สีฟ้า",
  "#รูป PS031S",
  "#แคตตาล็อก PS031S",
  "#ไซส์ PS031S",
  "",
  "เช็กสต็อกภายในร้าน (แสดงจำนวนพร้อมส่ง):",
  "#สต็อก เสื้อกีฬา สีฟ้า",
  "#พร้อมส่ง โปโล กรม",
  "#เช็ค PS031S",
  "",
  "เลขบัญชีรับโอน:",
  "#qr หรือ #เลขบัญชี = QR และเลขบัญชีหลักของบริษัท",
  "#qr กรุงเทพ = เฉพาะบัญชีที่ตั้งชื่อและเปิดอนุญาต",
  "#qr ทั้งหมด = ทุกบัญชีที่เปิดอนุญาต #qr",
].join("\n");

type CatalogCommandMode = "guide" | "size" | "catalog" | "photo" | "bank";

export type LineCatalogCommand = {
  mode: CatalogCommandMode;
  query: string;
  inStockOnly: boolean;
  showStockQty: boolean;
};

export type LineBotReplyResult = {
  status: "REPLIED_OK" | "REPLIED_FALLBACK" | "SKIPPED" | "FAILED";
  error: string | null;
};

type BotSize = {
  size: string;
  on_hand_qty: number;
};

type BotColorway = {
  model_id: string;
  model_code: string;
  model_name: string;
  catalog_name: string | null;
  color_code: string;
  color_name: string;
  display_image_url: string | null;
  has_colorway_image: boolean;
  model_main_image_url: string | null;
  catalog_image_url: string | null;
  size_chart_image_url: string | null;
  total_on_hand_qty: number;
  min_retail_price: number | null;
  max_retail_price: number | null;
  hex_code: string;
  sizes: BotSize[];
};

type BotModelCard = {
  model_id: string;
  model_code: string;
  model_name: string;
  catalog_name: string | null;
  model_main_image_url: string | null;
  catalog_image_url: string | null;
  size_chart_image_url: string | null;
};

type LineMessage = Record<string, unknown>;

type LooseRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function lineText(value: unknown): string {
  return String(value || "-").trim() || "-";
}

function flexLabel(label: string): string {
  const text = label.trim();
  if (!text) return "ดูรายละเอียด";
  return text.length <= FLEX_LABEL_LIMIT ? text : text.slice(0, FLEX_LABEL_LIMIT);
}

function safeHex(value: unknown): string {
  const text = String(value ?? "").trim();
  return HEX_COLOR.test(text) ? text.toUpperCase() : "#64748B";
}

function formatBaht(value: number): string {
  const whole = Math.abs(value - Math.round(value)) < 0.001;
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQty(value: number): string {
  if (value <= 0) return "0";
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value));
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(value);
}

export function toSafeLineHttpsUrl(raw?: string | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value.toLowerCase().startsWith("https://")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.href.length > 2000) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseLineCatalogCommand(text: string): LineCatalogCommand | null {
  const match = text.trim().match(COMMAND_RE);
  if (!match) return null;
  const verb = match[1].toLowerCase();
  const query = (match[2] ?? "").trim();
  if (verb === "qr" || verb === "เลขบัญชี" || verb === "บัญชี") {
    return { mode: "bank", query, inStockOnly: false, showStockQty: false };
  }
  if (verb === "คู่มือ" || verb === "คำสั่ง" || verb === "help" || !query) {
    return { mode: "guide", query: "", inStockOnly: false, showStockQty: false };
  }
  if (verb === "ไซส์" || verb === "ตารางไซส์" || verb === "ตารางขนาด" || verb === "size") {
    return { mode: "size", query, inStockOnly: false, showStockQty: false };
  }
  if (verb === "แคตตาล็อก" || verb === "แคตตาล๊อก" || verb === "catalog") {
    return { mode: "catalog", query, inStockOnly: false, showStockQty: false };
  }
  if (verb === "รูป") {
    return { mode: "photo", query, inStockOnly: false, showStockQty: false };
  }
  if (
    verb === "สต็อก" ||
    verb === "สต๊อก" ||
    verb === "พร้อมส่ง" ||
    verb === "เช็ค" ||
    verb === "เช็ก"
  ) {
    return { mode: "photo", query, inStockOnly: true, showStockQty: true };
  }
  return null;
}

function readSizes(value: unknown): BotSize[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const sizes: BotSize[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const size = textOrNull(row.size);
    if (!size) continue;
    const qty = toNumber(row.on_hand_qty);
    sizes.push({ size, on_hand_qty: qty > 0 ? qty : 0 });
  }
  return sizes;
}

function mapColorway(value: unknown): BotColorway | null {
  const row = asRecord(value);
  if (!row) return null;
  const modelId = textOrNull(row.model_id);
  if (!modelId) return null;
  const total = toNumber(row.total_on_hand_qty);
  return {
    model_id: modelId,
    model_code: textOrNull(row.model_code) ?? "",
    model_name: textOrNull(row.model_name) ?? "",
    catalog_name: textOrNull(row.catalog_name),
    color_code: textOrNull(row.color_code) ?? "",
    color_name: textOrNull(row.color_name) ?? "",
    display_image_url: textOrNull(row.display_image_url),
    has_colorway_image: row.has_colorway_image === true,
    model_main_image_url:
      textOrNull(row.model_main_image_url) ?? textOrNull(row.model_poster_url),
    catalog_image_url: textOrNull(row.catalog_image_url),
    size_chart_image_url: textOrNull(row.size_chart_image_url),
    total_on_hand_qty: total > 0 ? total : 0,
    min_retail_price: toNullableNumber(row.min_retail_price),
    max_retail_price: toNullableNumber(row.max_retail_price),
    hex_code: safeHex(row.hex_code),
    sizes: readSizes(row.sizes_breakdown),
  };
}

function mapModelCard(value: unknown): BotModelCard | null {
  const row = asRecord(value);
  if (!row) return null;
  const modelId = textOrNull(row.model_id);
  if (!modelId) return null;
  return {
    model_id: modelId,
    model_code: textOrNull(row.model_code) ?? "",
    model_name: textOrNull(row.model_name) ?? "",
    catalog_name: textOrNull(row.catalog_name),
    model_main_image_url: textOrNull(row.model_main_image_url),
    catalog_image_url: textOrNull(row.catalog_image_url),
    size_chart_image_url: textOrNull(row.size_chart_image_url),
  };
}

function retailLabel(min: number | null, max: number | null): string | null {
  if (min == null || min <= 0) return null;
  const high = max ?? min;
  if (!Number.isFinite(high) || high <= 0) return `฿${formatBaht(min)}`;
  if (Math.abs(min - high) < 0.005) return `฿${formatBaht(min)}`;
  return `฿${formatBaht(Math.min(min, high))}–${formatBaht(Math.max(min, high))}`;
}

function sizeLabels(row: BotColorway): string[] {
  return [
    ...new Set(
      row.sizes
        .map((size) => size.size.trim())
        .filter((size) => Boolean(size) && size !== "00"),
    ),
  ];
}

function readyLine(row: BotColorway, showStockQty: boolean): { text: string; color: string } {
  const labels = sizeLabels(row);
  if (!showStockQty) {
    return {
      text: labels.length > 0 ? `ไซส์: ${labels.join(" ")}` : "สอบถามไซส์ได้ที่ร้าน",
      color: "#475569",
    };
  }
  const ready = row.sizes.filter((size) => size.on_hand_qty > 0);
  if (row.total_on_hand_qty > 0 && ready.length > 0) {
    return {
      text: `พร้อมส่ง: ${ready
        .map((size) => `${size.size}(${formatQty(size.on_hand_qty)})`)
        .join(" ")}`,
      color: "#059669",
    };
  }
  return {
    text: labels.length
      ? `สต็อกหน้าร้าน 0 (ไซส์ในระบบ: ${labels.join(" ")})`
      : "สต็อกหน้าร้าน 0",
    color: "#64748B",
  };
}

function displayName(row: { catalog_name: string | null; model_name: string }): string {
  return lineText(row.catalog_name || row.model_name);
}

function summarizeRows(rows: BotColorway[], showStockQty = false): string {
  const first = rows[0];
  const price = retailLabel(first.min_retail_price, first.max_retail_price);
  const sizeLine = showStockQty
    ? rows
        .slice(0, 8)
        .map((row) => `${row.color_name} ${readyLine(row, true).text}`)
        .join("\n")
    : (() => {
        const labels = [
          ...new Set(rows.flatMap((row) => sizeLabels(row))),
        ];
        return labels.length ? `ไซส์: ${labels.join(" ")}` : "สอบถามไซส์ได้ที่ร้าน";
      })();
  return [
    `${displayName(first)} (${lineText(first.model_code)})`,
    price ? `ราคาปลีก ${price}` : "สอบถามราคาได้ที่ร้าน",
    sizeLine,
  ].join("\n");
}

function summarizeCard(card: BotModelCard): string {
  return [
    `${displayName(card)} (${lineText(card.model_code)})`,
    "ยังไม่มีตารางขนาดแยกในระบบ",
    "สอบถามราคาและไซส์พร้อมส่งได้ที่ร้าน",
  ].join("\n");
}

function textMessage(text: string): LineMessage {
  return { type: "text", text: lineText(text).slice(0, 4900) };
}

function imageMessage(url: string): LineMessage {
  return { type: "image", originalContentUrl: url, previewImageUrl: url };
}

function sheetUrlOf(row: {
  catalog_image_url: string | null;
  model_main_image_url: string | null;
}): string | null {
  return toSafeLineHttpsUrl(row.catalog_image_url) ?? toSafeLineHttpsUrl(row.model_main_image_url);
}

function sizeUrlOf(row: { size_chart_image_url: string | null }): string | null {
  return toSafeLineHttpsUrl(row.size_chart_image_url);
}

function buildBubble(row: BotColorway, showStockQty: boolean): LineMessage {
  const displayUrl = toSafeLineHttpsUrl(row.display_image_url);
  const title = displayName(row);
  const price = retailLabel(row.min_retail_price, row.max_retail_price);
  const ready = readyLine(row, showStockQty);
  const body: LineMessage[] = [
    {
      type: "text",
      text: lineText(row.model_code),
      size: "xs",
      weight: "bold",
      color: "#1D4ED8",
    },
    {
      type: "text",
      text: title,
      wrap: true,
      maxLines: 2,
      weight: "bold",
      size: "sm",
      color: "#0F172A",
    },
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      alignItems: "center",
      contents: [
        {
          type: "box",
          layout: "vertical",
          width: "14px",
          height: "14px",
          backgroundColor: row.hex_code,
          cornerRadius: "7px",
          contents: [{ type: "filler" }],
        },
        {
          type: "text",
          text: lineText(`${row.color_name} (${row.color_code || "-"})`),
          size: "xs",
          wrap: true,
          color: "#334155",
          flex: 1,
        },
      ],
    },
  ];
  if (price) {
    body.push({
      type: "text",
      text: lineText(price),
      size: "sm",
      weight: "bold",
      color: "#0F172A",
    });
  }
  body.push({
    type: "text",
    text: lineText(ready.text),
    wrap: true,
    size: "xs",
    color: ready.color,
  });

  const footer: LineMessage[] = [];
  if (row.catalog_image_url || row.model_main_image_url) {
    footer.push({
      type: "button",
      style: "link",
      height: "sm",
      action: {
        type: "message",
        label: flexLabel(CATALOG_BUTTON_LABEL),
        text: `#แคตตาล็อก ${row.model_code}`.slice(0, 300),
      },
    });
  }
  if (row.size_chart_image_url) {
    footer.push({
      type: "button",
      style: "link",
      height: "sm",
      action: {
        type: "message",
        label: flexLabel(SIZE_BUTTON_LABEL),
        text: `#ไซส์ ${row.model_code}`.slice(0, 300),
      },
    });
  }

  const bubble: LineMessage = {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: body,
    },
  };
  if (displayUrl) {
    bubble.hero = {
      type: "image",
      url: displayUrl,
      size: "full",
      aspectRatio: "3:4",
      aspectMode: row.has_colorway_image ? "cover" : "fit",
      backgroundColor: "#FFFFFF",
      action: { type: "uri", label: "ดูรูปขยาย", uri: displayUrl },
    };
  }
  if (footer.length > 0) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: footer,
    };
  }
  return bubble;
}

function flexCarousel(
  rows: BotColorway[],
  bubbleLimit: number,
  showStockQty: boolean,
): LineMessage | null {
  const cap = bubbleLimit > 1 ? Math.min(12, bubbleLimit) : 1;
  const bubbles = rows.slice(0, cap).map((row) => buildBubble(row, showStockQty));
  if (bubbles.length === 0) return null;
  const alt = rows
    .slice(0, cap)
    .map((row) => `${row.model_code} ${row.color_name}`.trim())
    .filter(Boolean)
    .join(", ");
  return {
    type: "flex",
    altText: (`แคตตาล็อก ${alt}`.trim() || "แคตตาล็อกสินค้า").slice(0, 380),
    contents: { type: "carousel", contents: bubbles },
  };
}

function bubbleCapFor(rows: BotColorway[]): number {
  if (rows.length === 0) return 10;
  const modelId = rows[0].model_id;
  return rows.every((row) => row.model_id === modelId) ? 12 : 10;
}

function imagePair(
  sheet: string | null,
  size: string | null,
): LineMessage[] {
  const messages: LineMessage[] = [];
  if (sheet) messages.push(imageMessage(sheet));
  if (size && size !== sheet) messages.push(imageMessage(size));
  return messages;
}

function isSingleModelShowcase(rows: BotColorway[], query: string): boolean {
  if (rows.length === 0) return false;
  const modelId = rows[0].model_id;
  if (!rows.every((row) => row.model_id === modelId)) return false;
  const oneWord = query.trim().split(/\s+/).length === 1;
  return rows.length > 1 || oneWord;
}

function focusRows(rows: BotColorway[], query: string): BotColorway[] | "many" {
  if (rows.length === 0) return [];
  const code = query.trim().toLowerCase();
  const exact = rows.filter((row) => row.model_code.toLowerCase() === code);
  if (exact.length > 0) return exact;
  const ids = new Set(rows.map((row) => row.model_id));
  if (ids.size === 1) return rows;
  return "many";
}

function codeList(rows: BotColorway[]): string {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.model_id)) continue;
    seen.add(row.model_id);
    codes.push(row.model_code || "-");
    if (codes.length >= 6) break;
  }
  return codes.join(", ");
}

async function searchColorways(
  query: string,
  inStockOnly: boolean,
): Promise<{ rows: BotColorway[]; error: string | null }> {
  const admin = createClient() as unknown as LooseRpc;
  const { data, error } = await admin.rpc("search_colorway_sales_catalog", {
    p_search_text: query,
    p_color_family: null,
    p_category_id: null,
    p_in_stock_only: inStockOnly,
    p_limit: 12,
  });
  if (error) return { rows: [], error: error.message };
  const rows = (Array.isArray(data) ? data : []).flatMap((row) => {
    const item = mapColorway(row);
    return item ? [item] : [];
  });
  return { rows, error: null };
}

async function lookupModels(query: string): Promise<{ cards: BotModelCard[]; error: string | null }> {
  const admin = createClient() as unknown as LooseRpc;
  const { data, error } = await admin.rpc("lookup_model_catalog_for_bot", {
    p_query: query,
  });
  if (error) return { cards: [], error: error.message };
  const cards = (Array.isArray(data) ? data : []).flatMap((row) => {
    const card = mapModelCard(row);
    return card ? [card] : [];
  });
  return { cards, error: null };
}

function pickCard(cards: BotModelCard[], query: string): BotModelCard | "many" | null {
  if (cards.length === 0) return null;
  const code = query.trim().toLowerCase();
  const exact = cards.find((card) => card.model_code.toLowerCase() === code);
  if (exact) return exact;
  if (cards.length === 1) return cards[0];
  return "many";
}

const SKIPPED: LineBotReplyResult = { status: "SKIPPED", error: null };

async function sendMessages(
  token: string,
  replyToken: string,
  messages: LineMessage[],
  plainTextSummary?: string,
): Promise<LineBotReplyResult> {
  const payload = messages.slice(0, 5);
  if (payload.length === 0) return { status: "FAILED", error: "ไม่มีข้อความให้ส่ง" };
  const result = await replyLineMessages(token, replyToken, payload);
  if (result.ok) return { status: "REPLIED_OK", error: null };

  const hasFlex = payload.some((message) => message.type === "flex");
  if (!hasFlex) {
    console.error("[line-catalog-bot]", result.error);
    return { status: "FAILED", error: result.error };
  }

  const validImages = payload.filter(
    (message) =>
      message.type === "image" &&
      typeof message.originalContentUrl === "string" &&
      message.originalContentUrl.startsWith("https://"),
  );
  const summary = lineText(plainTextSummary || "แคตตาล็อกสินค้า").slice(0, 4900);
  const retry = await replyLineMessages(token, replyToken, [
    ...validImages.slice(0, 2),
    { type: "text", text: summary },
  ]);
  if (!retry.ok) console.error("[line-catalog-bot] fallback", retry.error);
  return { status: "REPLIED_FALLBACK", error: result.error };
}

export async function handleLineCatalogBotEvent(params: {
  replyToken: string;
  text: string;
  token: string;
}): Promise<LineBotReplyResult> {
  const command = parseLineCatalogCommand(params.text);
  if (!command || !params.replyToken || !params.token) return SKIPPED;
  if (command.mode === "guide") {
    return sendMessages(params.token, params.replyToken, [textMessage(USAGE_GUIDE)], USAGE_GUIDE);
  }
  if (command.mode === "bank") {
    return replySupthaveeBankQr(params.token, params.replyToken, command.query);
  }

  const searched = await searchColorways(command.query, command.inStockOnly);
  if (searched.error) {
    return sendMessages(params.token, params.replyToken, [
      textMessage("ระบบค้นหาสินค้าชั่วคราวไม่พร้อม ลองใหม่อีกครั้ง"),
    ]);
  }

  if (command.mode === "photo" && isSingleModelShowcase(searched.rows, command.query)) {
    const first = searched.rows[0];
    const sheet = sheetUrlOf(first);
    const size = sizeUrlOf(first);
    const flex = flexCarousel(searched.rows, 12, command.showStockQty);
    const messages = [...imagePair(sheet, size)];
    if (flex) messages.push(flex);
    const summary = summarizeRows(searched.rows, command.showStockQty);
    if (messages.length === 0) messages.push(textMessage(summary));
    return sendMessages(params.token, params.replyToken, messages, summary);
  }

  if (command.mode === "photo" && searched.rows.length > 0) {
    const summary = summarizeRows(searched.rows, command.showStockQty);
    const flex = flexCarousel(searched.rows, bubbleCapFor(searched.rows), command.showStockQty);
    return sendMessages(
      params.token,
      params.replyToken,
      [flex ?? textMessage(summary)],
      summary,
    );
  }

  if (command.mode === "photo" && command.showStockQty && searched.rows.length === 0) {
    const allRows = await searchColorways(command.query, false);
    if (allRows.error) {
      return sendMessages(params.token, params.replyToken, [
        textMessage("ระบบค้นหาสินค้าชั่วคราวไม่พร้อม ลองใหม่อีกครั้ง"),
      ]);
    }
    if (allRows.rows.length > 0) {
      const notice = [
        `ไม่พบสต็อกพร้อมส่งหน้าร้านสำหรับ "${command.query}" (สต็อกคงเหลือ 0)`,
        "หากต้องการส่งรูปและไซส์ให้ลูกค้าเพื่อสั่งโรงงาน พิมพ์:",
        `#รูป ${command.query}`,
      ].join("\n");
      return sendMessages(params.token, params.replyToken, [textMessage(notice)], notice);
    }
  }

  const focused = focusRows(searched.rows, command.query);
  if (focused === "many") {
    const verb = command.mode === "size" ? "#ไซส์" : command.mode === "catalog" ? "#แคตตาล็อก" : "#รูป";
    const guide = `พบหลายรุ่น กรุณาระบุรหัส เช่น ${verb} ${codeList(searched.rows).split(", ")[0] ?? "PS031S"}\n${codeList(searched.rows)}`;
    return sendMessages(params.token, params.replyToken, [textMessage(guide)], guide);
  }

  if (Array.isArray(focused) && focused.length > 0) {
    return replyForKnownRows(params.token, params.replyToken, command.mode, focused);
  }

  const looked = await lookupModels(command.query);
  if (looked.error) {
    return sendMessages(params.token, params.replyToken, [
      textMessage("ระบบค้นหาสินค้าชั่วคราวไม่พร้อม ลองใหม่อีกครั้ง"),
    ]);
  }
  const card = pickCard(looked.cards, command.query);
  if (card === "many") {
    const codes = looked.cards
      .slice(0, 6)
      .map((item) => item.model_code || "-")
      .join(", ");
    const guide = `พบหลายรุ่น กรุณาระบุรหัสรุ่น\n${codes}`;
    return sendMessages(params.token, params.replyToken, [textMessage(guide)], guide);
  }
  if (!card) {
    const guide = `ไม่พบสินค้าจาก "${command.query}"\nลองรหัสรุ่น เช่น #รูป PS031S`;
    return sendMessages(params.token, params.replyToken, [textMessage(guide)], guide);
  }

  const sheet = sheetUrlOf(card);
  const size = sizeUrlOf(card);
  if (command.mode === "size") {
    const chart = size ?? toSafeLineHttpsUrl(card.catalog_image_url);
    const summary = chart ? displayName(card) : summarizeCard(card);
    const messages: LineMessage[] = [];
    if (chart) messages.push(imageMessage(chart));
    messages.push(textMessage(summary));
    return sendMessages(params.token, params.replyToken, messages, summary);
  }
  if (command.mode === "catalog") {
    const summary = sheet ? displayName(card) : summarizeCard(card);
    const messages = imagePair(sheet, size);
    messages.push(textMessage(summary));
    return sendMessages(params.token, params.replyToken, messages, summary);
  }
  const summary = summarizeCard(card);
  const messages = imagePair(sheet, size);
  messages.push(textMessage(summary));
  return sendMessages(params.token, params.replyToken, messages, summary);
}

async function replyForKnownRows(
  token: string,
  replyToken: string,
  mode: CatalogCommandMode,
  rows: BotColorway[],
): Promise<LineBotReplyResult> {
  const first = rows[0];
  const sheet = sheetUrlOf(first);
  const size = sizeUrlOf(first);
  const summary = summarizeRows(rows);
  const cap = bubbleCapFor(rows);
  if (mode === "size") {
    const chart = size ?? toSafeLineHttpsUrl(first.catalog_image_url);
    if (chart) {
      return sendMessages(
        token,
        replyToken,
        [imageMessage(chart), textMessage(summary)],
        summary,
      );
    }
    return sendMessages(token, replyToken, [textMessage(summary)], summary);
  }
  if (mode === "catalog") {
    if (sheet) {
      const messages = imagePair(sheet, size);
      messages.push(textMessage(displayName(first)));
      return sendMessages(token, replyToken, messages, summary);
    }
    const flex = flexCarousel(rows, cap, false);
    return sendMessages(token, replyToken, [flex ?? textMessage(summary)], summary);
  }
  const flex = flexCarousel(rows, cap, false);
  return sendMessages(token, replyToken, [flex ?? textMessage(summary)], summary);
}
