import type { Config } from "tailwindcss";

/**
 * Tailwind theme extensions for Supthavee ERP.
 * Note: Tailwind v4 primarily reads `@theme` in `app/globals.css`;
 * this file documents / mirrors font tokens (loaded via `@config`).
 */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sarabun: ["var(--font-sarabun)", "Sarabun", "Tahoma", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;

export default config;
