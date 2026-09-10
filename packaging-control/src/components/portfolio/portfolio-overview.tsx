import Link from "next/link";

import { plural } from "@/lib/labels";
import type { PortfolioProduct, PortfolioSummary } from "@/server/services/portfolio-service";

/**
 * El encabezado de la pantalla de inicio.
 *
 * Dice el estado de la cartera en una frase y despues abre lo unico que hace
 * falta saber para decidir a quien reclamar: cuantos componentes espera cada
 * requisito. No hay puntajes: un numero del 0 al 100 no dice que hacer, y dos
 * productos con el mismo numero pueden estar en situaciones muy distintas.
 */

export function PortfolioOverview({
  summary,
  attention
}: {
  summary: PortfolioSummary;
  attention: Array<{ product: PortfolioProduct; entry: PortfolioProduct["attention"][number] }>;
}) {
  const pending = summary.totalComponents - summary.closedComponents;

  return (
    <div className="stack-lg">
      <section className="hero-panel">
        <div>
          <h1>Cómo viene la cartera</h1>
          <p>
            {plural(summary.totalProducts, "producto")} en seguimiento, con {plural(summary.totalComponents, "componente")}{" "}
            de packaging entre todos.{" "}
            {summary.closedComponents > 0
              ? `${summary.closedComponents} ya cumplen todos los requisitos y ${pending} todavía no.`
              : `Ninguno cumple todavía los seis requisitos de cierre.`}
          </p>
          {summary.almostDone > 0 ? (
            <p className="hero-panel__highlight">
              {summary.almostDone === 1
                ? "Hay 1 componente al que le falta un solo requisito."
                : `Hay ${summary.almostDone} componentes a los que les falta un solo requisito.`}
            </p>
          ) : null}
        </div>
      </section>

      {attention.length ? (
        <section className="section-card section-card--alert">
          <header className="section-card__header">
            <div>
              <h2>Necesita una decisión tuya</h2>
              <p>
                Acá el requisito figura cumplido pero hay una señal que no se puede resolver sola: un código
                discontinuado que hay que reemplazar, uno que se pidió por error, o una estructura que espera tu
                confirmación. No dependen de que responda otro sector.
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
      ) : null}

      {summary.blockers.length ? (
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
                <span className="blocker__label">
                  {blocker.count === 1 ? "componente espera" : "componentes esperan"}
                </span>
                <strong className="blocker__requirement">{blocker.shortLabel}</strong>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
