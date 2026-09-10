import Link from "next/link";

import { CLOSURE_REQUIREMENT_ORDER, CLOSURE_REQUIREMENT_SHORT_LABELS } from "@/server/rules/closure-checklist";
import type { ComponentRequirement, PortfolioComponent } from "@/server/services/portfolio-service";

/**
 * La grilla de cierre de un producto: una fila por componente, una columna por
 * requisito.
 *
 * Es la pantalla que reemplaza el trabajo manual de abrir cinco archivos y
 * cruzarlos. Cada celda ya resolvio de que fuente sale el dato; al pasar el
 * mouse se ve el detalle exacto que se encontro (o no) en esa fuente.
 */

const CELL: Record<ComponentRequirement["status"], { mark: string; className: string; word: string }> = {
  met: { mark: "✓", className: "cell--met", word: "Cumplido" },
  missing: { mark: "·", className: "cell--missing", word: "Falta" },
  at_risk: { mark: "!", className: "cell--risk", word: "Revisar" },
  not_applicable: { mark: "–", className: "cell--na", word: "No aplica" }
};

export function ClosureMatrix({ components }: { components: PortfolioComponent[] }) {
  if (!components.length) {
    return (
      <p className="muted-text">
        Este producto todavía no tiene componentes derivados de su planilla de PM. Puede ser que la planilla no declare
        los materiales de empaque, o que todavía no se haya importado.
      </p>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table className="data-table matrix">
          <thead>
            <tr>
              <th>Componente</th>
              <th>Código</th>
              {CLOSURE_REQUIREMENT_ORDER.map((key) => (
                <th key={key} className="matrix__head">
                  {CLOSURE_REQUIREMENT_SHORT_LABELS[key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {components.map((component) => (
              <tr key={component.id} className={component.closed ? "matrix__row--closed" : undefined}>
                <td>
                  <Link className="table-link" href={`/componentes/${component.id}`}>
                    {component.name}
                  </Link>
                  <div className="table-subtitle">
                    {component.closed
                      ? "Cumple todos los requisitos"
                      : component.applicable - component.met === 1
                        ? `Le falta 1 de ${component.applicable}`
                        : `Le faltan ${component.applicable - component.met} de ${component.applicable}`}
                  </div>
                </td>
                <td>{component.materialCode ?? <span className="muted-text">Sin código</span>}</td>
                {component.requirements.map((requirement) => {
                  const cell = CELL[requirement.status];

                  return (
                    <td key={requirement.key} className={`cell ${cell.className}`} title={requirement.detail}>
                      <span aria-hidden>{cell.mark}</span>
                      <span className="sr-only">
                        {requirement.label}: {cell.word}. {requirement.detail}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="matrix__legend">
        <span className="cell cell--met" aria-hidden>
          ✓
        </span>{" "}
        cumplido
        <span className="cell cell--missing" aria-hidden>
          ·
        </span>{" "}
        falta
        <span className="cell cell--risk" aria-hidden>
          !
        </span>{" "}
        cumplido pero hay que revisarlo
        <span className="cell cell--na" aria-hidden>
          –
        </span>{" "}
        no aplica a este componente
      </p>
    </>
  );
}

/**
 * Lo que falta, agrupado por requisito. La grilla dice como esta cada
 * componente; esto dice que reclamo hay que hacer y por cuantos componentes.
 */
export function PendingByRequirement({ components }: { components: PortfolioComponent[] }) {
  const groups = CLOSURE_REQUIREMENT_ORDER.map((key) => {
    const affected = components.filter((component) => component.missing.includes(key));
    const sample = affected[0]?.requirements.find((requirement) => requirement.key === key);

    return { key, label: sample?.label ?? CLOSURE_REQUIREMENT_SHORT_LABELS[key], source: sample?.source, affected };
  }).filter((group) => group.affected.length > 0);

  if (!groups.length) {
    return <p className="muted-text">No queda ningún requisito pendiente en este producto.</p>;
  }

  return (
    <div className="list-stack">
      {groups.map((group) => (
        <div key={group.key} className="list-row list-row--stacked">
          <div>
            <div className="list-row__title">{group.label}</div>
            <div className="list-row__subtitle">
              {group.affected.map((component) => component.name).join(" · ")}
            </div>
          </div>
          <div className="list-row__meta">
            <span className="metric-pill">{group.source}</span>
            <span className="muted-text">
              {group.affected.length === 1 ? "1 componente" : `${group.affected.length} componentes`}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
