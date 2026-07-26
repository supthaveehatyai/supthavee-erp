import { redirect } from "next/navigation";

/** Legacy path → canonical dashboard route */
export default function LegacyVendorMappingRedirect() {
  redirect("/dashboard/procurement/vendor-mapping");
}
