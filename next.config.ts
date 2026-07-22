import type { NextConfig } from "next";

// Public Supabase keys (safe for client). Defaults so Vercel Git deploy works
// even if dashboard env vars are missing.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://zartihkavuijfhxiojzt.supabase.co";
const supabaseAnon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphcnRpaGthdnVpamZoeGlvanp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3NDk0MzgsImV4cCI6MjEwMDMyNTQzOH0.BXntF4N1XrY2QqIQ4XjvjBATvzGoLT8Tw4F0-Uq9ECE";

const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnon,
  },
};

export default nextConfig;
