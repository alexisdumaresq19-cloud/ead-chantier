import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
// Headings and numbers: a sturdy grotesque, close to the logo's lettering.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "EAD Chantier",
  description:
    "Plans, documents, photos et rapports journaliers des chantiers des Entreprises Allen Dumaresq.",
  applicationName: "EAD Chantier",
  appleWebApp: { capable: true, title: "EAD Chantier", statusBarStyle: "black-translucent" },
  // An internal tool: nothing here is for search engines.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr-CA" className={`${inter.variable} ${archivo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
