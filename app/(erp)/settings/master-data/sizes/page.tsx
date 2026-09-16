import { redirect } from "next/navigation";

export default function LegacyMasterSizesPage() {
  redirect("/settings/master-data?tab=sizes");
}
