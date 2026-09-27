import Link from "next/link";

import type { PortfolioProduct, PortfolioSummary } from "@/server/services/portfolio-service";

/**
 * Cuantos componentes espera cada requisito en toda la cartera.
 *
 * Estaba en la pantalla de inicio y se movio: es una foto interesante pero no
 * dispara ninguna accion -se lee "ay, mira vos" y despues uno busca por
 * producto igual-, y ocupaba el lugar de lo que si la dispara. Vive en
 * Componentes, que es la vista transversal, donde tiene sentido consultarla.
 */
export function PortfolioBlockers({ summary }: { summary: PortfolioSummary }) {
  if (!summary.blockers.length) {
    return null;
  }

  return (
    <section className="section-card">
      <header className="section-card__header">
        <div>
          <h2>Qué está esperando la cartera</h2>
          <p>Cuántos componentes espera cada requisito. Sirve para saber a qué sector reclamar y por cuánto.</p>
        </div>
      </header>

      <div className="blocker-grid">
        {summary.blockers.map((blocker) => (
          <article key={blocker.key} className="blocker">
            <span className="blocker__count">{blocker.count}</span>
            <span className="blocker__label">{blocker.count === 1 ? "componente espera" : "componentes esperan"}</span>
            <strong className="blocker__requirement">{blocker.shortLabel}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * Lo primero de la pantalla de inicio: lo que necesita una decision tuya.
 *
 * No hay titulo de bienvenida ni resumen general. El inicio tiene que disparar
 * una accion, no un pensamiento: si no hay nada que decidir, esta seccion no
 * aparece y la pantalla arranca directamente por la lista de productos.
 */
export function PortfolioAttention({
  attention
}: {
  attention: Array<{ product: PortfolioProduct; entry: PortfolioProduct["attention"][number] }>;
}) {
  if (!attention.length) {
    return null;
  }

  return (
    <section className="section-card section-card--alert">
      <header className="section-card__header">
        <div>
          <h2>Necesita una decisión tuya</h2>
          <p>
            Acá el requisito figura cumplido pero hay una señal que no se puede resolver sola: un código discontinuado
            que hay que reemplazar, uno que se pidió por error, un arte aprobado que quedó atrás del diseño, o una
            estructura que espera tu confirmación. No dependen de que responda otro sector.
          </p>
        </div>
      </header>

      <div className="list-stack">
        {attention.map(({ product, entry }, index) => (
          <Link key={`${product.id}:${index}`} href={`/productos/${product.id}`} className="list-row">
            <div>
              <div className="list-row__title">
                {product.displayName} · {entry.componentName}
              </div>
              <div className="list-row__subtitle">{entry.detail}</div>
            </div>
            <div className="list-row__meta">
              <span className="status-badge status-badge--warning">{entry.requirement}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
