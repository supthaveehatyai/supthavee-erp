/**
 * Canonical document action button labels — ERP-wide UI standard.
 * Use these everywhere to prevent human error and label drift.
 */

export const DOCUMENT_ACTIONS = {
  EDIT: "แก้ไขเอกสาร (Edit)",
  ISSUE: "ยืนยันและออกเอกสาร (Confirm & Issue)",
  VOID: "ยกเลิกเอกสาร (Void)",
  SAVE_DRAFT: "บันทึกร่าง (Save Draft)",
} as const;

export type DocumentActionKey = keyof typeof DOCUMENT_ACTIONS;
