import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  // Trailing slash helps Capacitor file:// / capacitor:// routing
  trailingSlash: true,
};

export default nextConfig;
