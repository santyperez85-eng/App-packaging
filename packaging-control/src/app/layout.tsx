import type { Metadata } from "next";
import { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Control de packaging",
  description: "Qué le falta a cada producto para poder darse por cerrado"
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
