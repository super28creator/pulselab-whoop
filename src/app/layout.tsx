import type { Metadata, Viewport } from "next";
import { Outfit, Space_Grotesk } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--font-display",
  display: "swap",
  preload: true,
});

const body = Outfit({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "PulseLab — Whoop 5",
  description: "Recovery, Strain, Sleep — lokalnie z Twojej opaski",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#050506",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: `
#boot-splash{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#050506;transition:opacity .35s ease,visibility .35s}
#boot-splash.gone{opacity:0;visibility:hidden;pointer-events:none}
#boot-splash .bs-inner{text-align:center}
#boot-splash .bs-brand{font-family:system-ui,sans-serif;font-weight:800;letter-spacing:.32em;font-size:.85rem;background:linear-gradient(90deg,#16ec92,#00f0ff);-webkit-background-clip:text;background-clip:text;color:transparent;margin:0 0 .85rem}
#boot-splash .bs-ring{width:52px;height:52px;margin:0 auto;border-radius:50%;border:2px solid rgba(22,236,146,.2);border-top-color:#16ec92;animation:bs-spin .7s linear infinite}
#boot-splash .bs-sub{margin:.9rem 0 0;color:#8a8a92;font-size:.78rem;font-family:system-ui,sans-serif}
@keyframes bs-spin{to{transform:rotate(360deg)}}
`,
          }}
        />
      </head>
      <body className={`${display.variable} ${body.variable}`}>
        <div id="boot-splash" aria-live="polite">
          <div className="bs-inner">
            <p className="bs-brand">PULSELAB</p>
            <div className="bs-ring" aria-hidden />
            <p className="bs-sub">Ładuję dane…</p>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
