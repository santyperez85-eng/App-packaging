import Link from "next/link";

/**
 * Rastro de navegacion.
 *
 * Existe porque entrar a una ficha era un callejon sin salida: la unica forma
 * de volver era el logo. Cada nivel es un link, asi que desde un componente se
 * puede subir a su producto o al listado sin pasar por el inicio.
 */
export type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumb" aria-label="Dónde estás">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <span key={`${item.label}:${index}`} className="breadcrumb__item">
            {item.href && !isLast ? (
              <Link href={item.href} className="breadcrumb__link">
                {item.label}
              </Link>
            ) : (
              <span aria-current={isLast ? "page" : undefined}>{item.label}</span>
            )}
            {isLast ? null : (
              <span className="breadcrumb__separator" aria-hidden>
                ›
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
