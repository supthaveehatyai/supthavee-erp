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
