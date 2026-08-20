import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Expense OCR FormData (compressed image) — avoid 413 on Vercel
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;