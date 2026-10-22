export type ProcurementBillAttachment = {
  name: string;
  path: string;
  url: string;
  type: string;
  size: number;
  uploaded_at: string;
};

export type ProcurementBillSet = {
  attachment_urls: string[];
  attachments: ProcurementBillAttachment[];
};

export type UploadProcurementBillResult = {
  data: ProcurementBillAttachment | null;
  error: string | null;
};

export type SaveProcurementBillsResult = {
  success: boolean;
  error: string | null;
};
