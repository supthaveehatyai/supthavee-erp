import type { Metadata } from "next";
import { Geist, Geist_Mono, Sarabun } from "next/font/google";
import { Toaster } from "sonner";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import AppShell from "./app-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Official Thai government-document font (50 ทวิ / ภ.ง.ด. print) */
const sarabun = Sarabun({
  variable: "--font-sarabun",
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Supthavee ERP",
    template: "%s | Supthavee ERP",
  },
  description: "ระบบบริหารจัดการทรัพยากรองค์กร บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentUser = await getCurrentAuthUser();

  return (
    <html lang="th" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className={sarabun.variable}>
        <AppShell userDisplayName={currentUser?.displayName ?? null}>
          {children}
        </AppShell>
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
