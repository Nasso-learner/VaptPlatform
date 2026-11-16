import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "VAPT Scanner", description: "SAST + DAST security scanning" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header><Link href="/">🛡 VAPT Scanner</Link></header>
        <main>{children}</main>
      </body>
    </html>
  );
}
