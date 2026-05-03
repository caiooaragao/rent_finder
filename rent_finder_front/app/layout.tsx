import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppThemeProvider from "@/Components/AppThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HomeSpread",
  description:
    "Explore anúncios de imóveis num mapa — busca, filtros e área geográfica.",
  icons: {
    icon: [{ url: "/homespread-logo.svg", type: "image/svg+xml", sizes: "512x512" }],
    apple: "/homespread-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}
