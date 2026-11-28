import { asRows } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";

export async function fnbMonthLockMessage(branchCode: string, workDate: string, brandLock?: string | null): Promise<string | null> {
  const year = Number(workDate.slice(0, 4));
  const month = Number(workDate.slice(5, 7));
  if (!year || !month) return null;
  const db = schemaAdmin().schema("fnb");
  let brand = brandLock === "CHATORN" || brandLock === "LUCKY_CUP" ? brandLock : "";
  if (!brand && branchCode) {
    const branch = await db.from("branches").select("brand_code").eq("branch_code", branchCode).limit(1);
    const row = asRows(branch.data)[0];
    brand = String(row?.brand_code ?? "");
  }
  if (brand !== "CHATORN" && brand !== "LUCKY_CUP") return null;
  const listed = await db.from("accounting_audit_periods").select("is_locked").eq("brand_code", brand).eq("period_year", year).eq("period_month", month).limit(1);
  if (asRows(listed.data)[0]?.is_locked === true) return "งวดเดือนนี้ถูกล็อกปิดงวดแล้ว (อ่านอย่างเดียว)";
  return null;
}
