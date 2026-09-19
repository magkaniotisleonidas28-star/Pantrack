import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pantrack | Purchasing workspace",
  description: "Prepare café orders across suppliers, manage products, and track purchasing history.",
  referrer: "no-referrer",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
