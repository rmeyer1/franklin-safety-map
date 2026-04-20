import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Franklin Safety Map",
  description: "Real-time public safety and mobility dashboard for Franklin County.",
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

