import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
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

export const metadata: Metadata = {
  title: {
    default: "Supthavee ERP",
    template: "%s | Supthavee ERP",
  },
  description: "ระบบบริหารจัดการทรัพยากรองค์กร บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
