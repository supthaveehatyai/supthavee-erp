import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getDocumentById,
  listActiveCustomers,
} from "@/lib/actions/document-actions";
import SalesOrderWorkspace from "../../create/sales-order-workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `แก้ไขใบสั่งขาย | Sales Order`,
    description: `แก้ไขร่างใบสั่งขาย ${id}`,
  };
}

export default async function EditSalesOrderPage({ params }: PageProps) {
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
  if (doc.doc_type !== "SO") {
    notFound();
  }

  if (doc.status !== "DRAFT") {
    redirect(`/sales/${encodeURIComponent(doc.doc_no)}`);
  }

  return (
    <SalesOrderWorkspace
      document={doc}
      customers={customersResult.data}
      customersError={customersResult.error}
    />
  );
}
