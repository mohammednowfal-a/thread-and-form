import type { Metadata, Viewport } from "next";
import "./globals.css";
import { appUrl } from "@/lib/env";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: "THREAD & FORM | Considered clothing, paid for on delivery", template: "%s | THREAD & FORM" },
  description: "Heavyweight cotton, linen and outerwear made to last. Order with Cash on Delivery and confirm on WhatsApp.",
  openGraph: { siteName: "THREAD & FORM", type: "website" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1E2B5C" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
