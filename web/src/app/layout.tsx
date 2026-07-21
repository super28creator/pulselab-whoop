import type { Metadata, Viewport } from "next";
import { Syne, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-display" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PulseLab — Whoop 5",
  description: "Lokalne tetno z Whoop 5",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0b0f0c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className={`${syne.variable} ${plex.variable}`}>{children}</body>
    </html>
  );
}
