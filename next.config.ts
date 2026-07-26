import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb", // ขยายลิมิตให้รองรับรูปบิล Base64 ขนาดใหญ่สำหรับการทำ AI OCR
    },
  },
};

export default nextConfig;