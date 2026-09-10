"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { formatShortCalendarDate, labels, plural, relativeToToday } from "@/lib/labels";
import { CLOSURE_REQUIREMENT_ORDER, CLOSURE_REQUIREMENT_SHORT_LABELS } from "@/server/rules/closure-checklist";
import type { PortfolioProduct, RequirementCoverage } from "@/server/services/portfolio-service";

/**
 * La lista de productos es la pantalla de inicio: una fila por producto y una
 * columna por requisito de cierre.
 *
 * La primera version listaba "que le falta" a cada producto, pero con la
 * cartera real casi todos deben casi todo, asi que cada fila decia lo mismo y
 * la columna no distinguia nada. Con una columna por requisito, en cambio, se
 * lee en vertical: si toda la columna Receta esta en rojo, el problema no es de
 * un producto sino de la cartera entera.
 *
 * Es un componente de cliente unicamente por el buscador. Filtra por nombre de
 * producto, que es como se busca en el sector; tambien acepta la presentacion y
 * la droga activa porque muchas veces uno se acuerda de "el de 28 comprimidos"
 * antes que del nombre exacto.
 */

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function ClosureBar({ closed, total }: { closed: number; total: number }) {
  if (!total) {
    return <span className="muted-text">Sin componentes</span>;
  }

  return (
    <div className="closure">
      <div className="closure__track" role="img" aria-label={`${closed} de ${total} componentes cerrados`}>
        <span className="closure__fill" style={{ width: `${(closed / total) * 100}%` }} />
      </div>
      <span className="closure__count">
        {closed} de {total}
      </span>
    </div>
  );
}

function CoverageCell({ coverage, label }: { coverage: RequirementCoverage; label: string }) {
  if (coverage.applicable === 0) {
    return (
      <td className="cell cell--na" title={`${label}: no aplica a ningún componente de este producto`}>
        <span aria-hidden>–</span>
        <span className="sr-only">{label}: no aplica</span>
      </td>
    );
  }

  const complete = coverage.met === coverage.applicable;
  const none = coverage.met === 0;
  const className = complete ? "cell--met" : none ? "cell--missing" : "cell--partial";
  const description = `${label}: ${coverage.met} de ${plural(coverage.applicable, "componente")}`;

  return (
    <td className={`cell ${className}`} title={description}>
      <span aria-hidden>{complete ? "✓" : none ? "·" : `${coverage.met}/${coverage.applicable}`}</span>
      <span className="sr-only">{description}</span>
    </td>
  );
}

/**
 * El orden por defecto es por fecha de lanzamiento. Como hoy ninguna esta
 * cargada, se ofrecen los otros criterios en vez de elegir uno por el usuario:
 * cual conviene depende de si esta repasando la cartera o buscando algo puntual.
 */
const SORTS = {
  launch: "Por fecha de lanzamiento",
  pending: "Por lo que más falta",
  closest: "Por lo más cerca de cerrar",
  name: "Por nombre"
} as const;

type SortKey = keyof typeof SORTS;

function pendingCount(product: PortfolioProduct) {
  return product.blockers.reduce((total, blocker) => total + blocker.count, 0);
}

export function ProductList({ products }: { products: PortfolioProduct[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("launch");

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    const matches = needle
      ? products.filter((product) =>
          normalize(
            [product.displayName, product.presentation, product.activeIngredient].filter(Boolean).join(" ")
          ).includes(needle)
        )
      : products;

    // `products` ya viene ordenado por fecha desde el servidor.
    if (sort === "launch") {
      return matches;
    }

    const sorted = [...matches];

    if (sort === "name") {
      return sorted.sort((left, right) => left.displayName.localeCompare(right.displayName, "es"));
    }

    if (sort === "closest") {
      // Un producto sin componentes no esta "cerca de cerrar": va al final.
      return sorted.sort(
        (left, right) =>
          Number(right.totalComponents > 0) - Number(left.totalComponents > 0) ||
          right.almostDone - left.almostDone ||
          pendingCount(left) - pendingCount(right)
      );
    }

    return sorted.sort((left, right) => pendingCount(right) - pendingCount(left));
  }, [products, query, sort]);

  return (
    <section className="section-card">
      <header className="section-card__header">
        <div>
          <h2>Productos</h2>
          <p>
            Una columna por requisito de cierre.{" "}
            {sort === "launch"
              ? "Ordenados por fecha de lanzamiento; los que todavía no tienen fecha van al final, primero el que más requisitos tiene pendientes."
              : SORTS[sort] + "."}
          </p>
        </div>
        <div className="toolbar">
          <input
            type="search"
            className="search-input"
            placeholder="Buscar producto…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Buscar producto por nombre"
          />
          <select
            className="select-input"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Ordenar productos"
          >
            {Object.entries(SORTS).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="muted-text">No hay ningún producto que coincida con «{query}».</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table matrix">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cerrados</th>
                  {CLOSURE_REQUIREMENT_ORDER.map((key) => (
                    <th key={key} className="matrix__head">
                      {CLOSURE_REQUIREMENT_SHORT_LABELS[key]}
                    </th>
                  ))}
                  <th>Lanzamiento</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((product) => (
                  <tr key={product.id} className={product.readyToClose ? "matrix__row--closed" : undefined}>
                    <td>
                      <Link className="table-link" href={`/productos/${product.id}`}>
                        {product.displayName}
                      </Link>
                      <div className="table-subtitle">{product.presentation ?? "Sin presentación"}</div>
                      {product.attention.length ? (
                        <div className="table-subtitle table-subtitle--alert">
                          {product.attention.length === 1
                            ? "1 punto necesita una decisión tuya"
                            : `${product.attention.length} puntos necesitan una decisión tuya`}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <ClosureBar closed={product.closedComponents} total={product.totalComponents} />
                      {product.almostDone > 0 ? (
                        <div className="table-subtitle">
                          {product.almostDone === 1
                            ? "1 está a un solo requisito"
                            : `${product.almostDone} están a un solo requisito`}
                        </div>
                      ) : null}
                    </td>
                    {product.coverage.map((coverage) => (
                      <CoverageCell key={coverage.key} coverage={coverage} label={coverage.shortLabel} />
                    ))}
                    <td>
                      {product.launchDate ? (
                        <>
                          <div>{formatShortCalendarDate(product.launchDate)}</div>
                          <div className="table-subtitle">{relativeToToday(product.launchDate)}</div>
                        </>
                      ) : (
                        <span className="muted-text">Sin fecha</span>
                      )}
                      <div className="table-subtitle">{labels.projectStatus(product.status).text}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="matrix__legend">
            En cada columna:
            <span className="cell cell--met" aria-hidden>
              ✓
            </span>{" "}
            lo cumplen todos los componentes
            <span className="cell cell--partial" aria-hidden>
              2/4
            </span>{" "}
            lo cumplen algunos
            <span className="cell cell--missing" aria-hidden>
              ·
            </span>{" "}
            no lo cumple ninguno
            <span className="cell cell--na" aria-hidden>
              –
            </span>{" "}
            no aplica
          </p>
        </>
      )}
    </section>
  );
}
