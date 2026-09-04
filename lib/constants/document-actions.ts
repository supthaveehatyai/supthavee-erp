/**
 * Canonical document action button labels — ERP-wide UI standard.
 * Use these everywhere to prevent human error and label drift.
 */

export const DOCUMENT_ACTIONS = {
  EDIT: "แก้ไขเอกสาร (Edit)",
  ISSUE: "ยืนยันและออกเอกสาร (Confirm & Issue)",
  VOID: "ยกเลิกเอกสาร (Void)",
  DELETE_DRAFT: "ลบเอกสารร่าง (Delete Draft)",
  SAVE_DRAFT: "บันทึกร่าง (Save Draft)",
  SEND_TO_PRODUCTION: "ส่งงานผลิต (Send to Production)",
} as const;

export type DocumentActionKey = keyof typeof DOCUMENT_ACTIONS;
