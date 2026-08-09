import { redirect } from "next/navigation";

/** Alias → Company Settings (Phase 10 SSOT) */
export default function SettingsIndexPage() {
  redirect("/settings/company");
}
