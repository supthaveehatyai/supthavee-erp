import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Vercel Output File Tracing: backup Server Action exec's `node scripts/backup/*.mjs`
   * via dynamic path — NFT cannot detect those files automatically.
   * Include the whole backup folder in server traces (dashboard + global fallback).
   */
  outputFileTracingIncludes: {
    "/dashboard": ["./scripts/backup/**/*"],
    "/*": ["./scripts/backup/**/*"],
  },
  experimental: {
    serverActions: {
      // Expense OCR FormData (compressed image) — avoid 413 on Vercel
      bodySizeLimit: "5mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "xurwbxpzzlrlntpywtdi.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "54321",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
