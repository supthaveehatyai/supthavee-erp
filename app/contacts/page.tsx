import type { Metadata } from "next";
import ContactsClient from "./contacts-client";

export const metadata: Metadata = {
  title: "คู่ค้าและผู้ติดต่อ | Contacts",
  description:
    "จัดการลูกค้าและผู้จำหน่าย พร้อมค้นหา กรอง และนำเข้าข้อมูล CSV",
};

export default function ContactsPage() {
  return <ContactsClient />;
}
