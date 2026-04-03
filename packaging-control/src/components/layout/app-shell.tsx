import Link from "next/link";
import { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Vista ejecutiva" },
  { href: "/projects", label: "Proyectos" },
  { href: "/project-items", label: "Project Items" },
  { href: "/alerts", label: "Alertas" }
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__eyebrow">Internal Ops</span>
          <Link href="/" className="topbar__title">
            Packaging Control
          </Link>
        </div>

        <nav className="topbar__nav" aria-label="Main navigation">
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
