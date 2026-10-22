import { uploadProcurementBillFile } from "@/lib/actions/procurement-bills";
import { compressBillFile } from "@/lib/procurement/compress-bill-image";
import type { ProcurementBillSet } from "@/types/procurement-bills";

export async function uploadProcurementBills(
  files: File[],
  vendorRef: string,
): Promise<{ data: ProcurementBillSet | null; error: string | null }> {
  if (files.length === 0) {
    return { data: { attachment_urls: [], attachments: [] }, error: null };
  }

  const timestamp = String(Date.now());
  const attachments = [];
  for (let index = 0; index < files.length; index += 1) {
    let prepared: File;
    try {
      prepared = await compressBillFile(files[index]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "บีบอัดรูปบิลไม่สำเร็จ";
      return { data: null, error: message };
    }

    const body = new FormData();
    body.set("file", prepared);
    body.set("vendorRef", vendorRef);
    body.set("index", String(index));
    body.set("timestamp", timestamp);
    const result = await uploadProcurementBillFile(body);
    if (result.error || !result.data) {
      return { data: null, error: result.error ?? "อัปโหลดรูปบิลไม่สำเร็จ" };
    }
    attachments.push(result.data);
  }

  return {
    data: {
      attachment_urls: attachments.map((item) => item.url),
      attachments,
    },
    error: null,
  };
}
