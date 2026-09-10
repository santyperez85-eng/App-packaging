import Link from "next/link";
import { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Productos" },
  { href: "/componentes", label: "Componentes" },
  { href: "/revision", label: "Decisiones" },
  { href: "/avisos", label: "Avisos" }
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <Link href="/" className="topbar__title">
            Control de packaging
          </Link>
        </div>

        <nav className="topbar__nav" aria-label="Secciones">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="page-frame">{children}</main>
    </div>
  );
}
