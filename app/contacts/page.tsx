import type { Metadata } from "next";
import ContactsClient from "./contacts-client";
import { getContacts } from "@/lib/actions/contacts";

export const metadata: Metadata = {
  title: "คู่ค้าและผู้ติดต่อ | Contacts",
  description:
    "จัดการลูกค้าและผู้จำหน่าย พร้อมค้นหา กรอง และนำเข้าข้อมูล CSV",
};

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { data, error } = await getContacts();

  return (
    <ContactsClient
      initialContacts={data}
      initialError={error ?? ""}
    />
  );
}
