import type { Metadata } from "next";
import { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Packaging Control",
  description: "Sistema interno de control de packaging para desarrollo de producto"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
