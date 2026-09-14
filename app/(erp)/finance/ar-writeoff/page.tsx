import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type ArWriteoffIndexProps = {
  searchParams: Promise<{ contact_id?: string }>;
};

export default async function ArWriteoffIndexPage({
  searchParams,
}: ArWriteoffIndexProps) {
  const params = await searchParams;
  const contactId = params.contact_id?.trim() || "";
  const suffix = contactId
    ? `?contact_id=${encodeURIComponent(contactId)}`
    : "";
  redirect(`/finance/ar-writeoff/create${suffix}`);
}
