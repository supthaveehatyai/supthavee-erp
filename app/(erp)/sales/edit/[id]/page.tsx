import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getDocumentById,
  listActiveCustomers,
} from "@/lib/actions/document-actions";
import { SALES_DOC_TYPES } from "@/lib/constants/document";
import type { DocumentType } from "@/types/document";
import SalesEditWorkspace from "./sales-edit-workspace";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `แก้ไขเอกสาร | Sales`,
    description: `แก้ไขเอกสารร่าง ${id}`,
  };
}

export const dynamic = "force-dynamic";

function isSalesDocType(docType: DocumentType): boolean {
  return (SALES_DOC_TYPES as readonly string[]).includes(docType);
}

/**
 * Server Component — load DRAFT by UUID, then Client edit workspace.
 */
export default async function EditSalesDocumentPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const documentId = decodeURIComponent(rawId ?? "").trim();
  if (!documentId) {
    notFound();
  }

  const [documentResult, customersResult] = await Promise.all([
    getDocumentById(documentId),
    listActiveCustomers(),
  ]);

  if (documentResult.error || !documentResult.data) {
    notFound();
  }

  const doc = documentResult.data;
  if (!isSalesDocType(doc.doc_type)) {
    notFound();
  }

  if (doc.status !== "DRAFT") {
    redirect(`/sales/${encodeURIComponent(doc.doc_no)}`);
  }

  return (
    <SalesEditWorkspace
      document={doc}
      customers={customersResult.data}
      customersError={customersResult.error}
    />
  );
}
