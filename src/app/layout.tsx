import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MyWorld 3D Map",
  description:
    "A private, contributor-driven 3D mapping platform. Capture with your phone, reconstruct with AI-assisted photogrammetry, and grow your own living 3D map.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark">
      <body
        className={`${manrope.variable} ${grotesk.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
