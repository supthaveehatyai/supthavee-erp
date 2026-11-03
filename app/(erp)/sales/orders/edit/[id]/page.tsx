import { notFound, redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditSalesOrderPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const documentId = decodeURIComponent(rawId ?? "").trim();
  if (!documentId) notFound();
  redirect(`/sales/edit/${encodeURIComponent(documentId)}`);
}
