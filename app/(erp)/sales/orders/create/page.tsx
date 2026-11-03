import { redirect } from "next/navigation";

export default function CreateSalesOrderPage() {
  redirect("/sales/create?doc_type=SO");
}
