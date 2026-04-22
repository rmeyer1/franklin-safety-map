import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Warren Safety Map",
  description: "Real-time public safety and mobility dashboard for the current Warren County pilot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
