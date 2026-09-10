import Link from "next/link";

import { SectionCard } from "@/components/ui/section-card";
import { labels, plural } from "@/lib/labels";
import { portfolioService } from "@/server/services/portfolio-service";

export const dynamic = "force-dynamic";

/**
 * La lista plana de componentes. La lectura principal es por producto, pero
 * esta vista sirve para lo transversal: perseguir un mismo requisito faltante
 * en toda la cartera sin entrar producto por producto.
 */
export default async function ComponentsPage() {
  const portfolio = await portfolioService.getPortfolio();
  const rows = portfolio
    .flatMap((product) => product.components.map((component) => ({ product, component })))
    // Primero lo que esta mas cerca de cerrarse: son los reclamos mas cortos.
    .sort((left, right) => {
      if (left.component.closed !== right.component.closed) {
        return left.component.closed ? 1 : -1;
      }

      return left.component.missing.length - right.component.missing.length;
    });

  const pending = rows.filter((row) => !row.component.closed).length;

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <h1>Componentes</h1>
        <p className="page-intro__summary">
          {plural(rows.length, "componente")} de packaging en toda la cartera.{" "}
          {pending === rows.length
            ? "Ninguno cumple todavía los seis requisitos."
            : `${pending} todavía no cumplen los seis requisitos.`}{" "}
          Los que están más cerca de cerrarse aparecen primero.
        </p>
      </section>

      <SectionCard
        title="Todos los componentes"
        description="Qué le falta a cada uno, sin importar de qué producto viene."
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Producto</th>
                <th>Código</th>
                <th>Qué falta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ product, component }) => (
                <tr key={component.id}>
                  <td>
                    <Link className="table-link" href={`/componentes/${component.id}`}>
                      {component.name}
                    </Link>
                    <div className="table-subtitle">{labels.componentSlot(component.slot)}</div>
                  </td>
                  <td>
                    <Link className="table-link" href={`/productos/${product.id}`}>
                      {product.displayName}
                    </Link>
                  </td>
                  <td>{component.materialCode ?? <span className="muted-text">Sin código</span>}</td>
                  <td>
                    {component.closed ? (
                      <span className="status-badge status-badge--success">Nada: está cerrado</span>
                    ) : (
                      <div className="chip-row">
                        {component.requirements
                          .filter((requirement) => requirement.status === "missing")
                          .map((requirement) => (
                            <span key={requirement.key} className="chip">
                              {requirement.shortLabel}
                            </span>
                          ))}
                        {component.requirements
                          .filter((requirement) => requirement.status === "at_risk")
                          .map((requirement) => (
                            <span key={requirement.key} className="chip chip--risk">
                              {requirement.shortLabel}: revisar
                            </span>
                          ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
