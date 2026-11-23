export const LINE_OA_ACCOUNT_UID = "Uee615b6b163db49d6ba28eda90f9cea0";
export const H3_LINE_GROUP_ID = "C0c28a7742fec9b94586a43903be60b1a";
export const H3_LINE_GROUP_NAME = "พี่ต๋อง H3-ทรัพย์ทวี(8)";

export function isH3Contact(name: string | null | undefined): boolean {
  return /เอชทรี|h3/i.test(name ?? "");
}

export function extractLineTargetId(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  const fromChat = raw.match(/\/chat\/([A-Za-z0-9]+)/i);
  if (fromChat?.[1]) return fromChat[1];
  if (/^[CUcu][A-Za-z0-9]{10,}$/.test(raw)) return raw;
  return null;
}

export function lineBizChatUrl(oaAccountUid: string, targetId: string): string {
  return `https://chat.line.biz/${oaAccountUid}/chat/${targetId}`;
}

/** Frozen Vercel preview hosts such as `supthavee-2qzy5pxrt-supthavee-erp.vercel.app`. */
const VERCEL_DEPLOYMENT_HASH_URL =
  /^https?:\/\/[a-z0-9-]+-[a-z0-9]{8,12}-[a-z0-9-]+\.vercel\.app(?:[/?#]|$)/i;

export function isVercelDeploymentHashUrl(url: string): boolean {
  return VERCEL_DEPLOYMENT_HASH_URL.test(String(url ?? "").trim());
}

function httpsOrigin(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Permanent production base URL.
 * 1) Explicit admin HTTPS URL that is not a Vercel deployment-hash host.
 * 2) `VERCEL_PROJECT_PRODUCTION_URL` (stable alias, updates on every push to main).
 * 3) `NEXT_PUBLIC_APP_URL` only when it is not a deployment-hash host.
 */
export function resolveCanonicalProductionBaseUrl(explicitUrl?: string | null): string | null {
  const explicit = httpsOrigin(explicitUrl);
  if (explicit && !isVercelDeploymentHashUrl(explicit)) return explicit;
  const production = httpsOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (production && !isVercelDeploymentHashUrl(production)) return production;
  const app = httpsOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (app && !isVercelDeploymentHashUrl(app)) return app;
  return null;
}

export function resolveCanonicalLineWebhookEndpoint(explicitUrl?: string | null): string | null {
  const base = resolveCanonicalProductionBaseUrl(explicitUrl);
  if (!base || isVercelDeploymentHashUrl(base)) return null;
  return `${base}/api/line/webhook`;
}

/** Recommended webhook from the permanent Vercel production domain only. */
export function recommendedProductionWebhookUrl(): string | null {
  const production = httpsOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!production || isVercelDeploymentHashUrl(production)) return null;
  return `${production}/api/line/webhook`;
}

/** ข้อความแจ้งโอน 4 บรรทัด สำหรับ LINE OA และปุ่มคัดลอก */
export function vendorTransferNotice(
  vendorName: string,
  paymentDateOnly: string,
  formattedTotalAmount: string,
): string {
  return [
    `เรียน ${vendorName}`,
    "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด ขอแจ้งโอนชำระค่าสินค้าครับ",
    `วันที่โอน: ${paymentDateOnly}`,
    `ยอดโอนชำระสุทธิ: ${formattedTotalAmount} บาท`,
  ].join("\n");
}
