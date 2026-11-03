/** ร่างยกเลิกแล้วออกทดแทน — ล็อกยอดเงิน ไม่ใช่ร่างที่แปลงมาจาก SO/QT */
export function isCancelAndReplaceDraft(input: {
  refDocumentId?: string | null;
  docType?: string | null;
  notes?: string | null;
}): boolean {
  if (!input.refDocumentId || input.docType === "CN") return false;
  return String(input.notes ?? "").includes("ออกทดแทนเอกสารเลขที่");
}
