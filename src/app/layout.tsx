import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = { title: "NOVRA", description: "Social content engine" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = jar.get("novra_theme")?.value;
  const lang = jar.get("novra_lang")?.value === "id" ? "id" : "en";
  return (
    <html lang={lang} className={theme === "dark" ? "dark" : ""} suppressHydrationWarning>
      <body className="min-h-screen antialiased font-sans">{children}</body>
    </html>
  );
}
