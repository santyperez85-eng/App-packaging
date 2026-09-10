import type { ComponentRequirement } from "@/server/services/portfolio-service";

/**
 * El checklist de un componente, requisito por requisito.
 *
 * Cada linea dice tres cosas: si esta cumplido, que se encontro exactamente, y
 * de que fuente salio ese dato. Esa tercera parte es la que evita tener que ir
 * a mirar el Excel para confirmar: si dice "Recetas" y "todavia no esta
 * cargado", ya se sabe donde reclamar y no hace falta abrir nada.
 */

const STATUS: Record<ComponentRequirement["status"], { word: string; className: string }> = {
  met: { word: "Cumplido", className: "requirement--met" },
  missing: { word: "Falta", className: "requirement--missing" },
  at_risk: { word: "Revisar", className: "requirement--risk" },
  not_applicable: { word: "No aplica", className: "requirement--na" }
};

export function ComponentChecklist({ requirements }: { requirements: ComponentRequirement[] }) {
  return (
    <ol className="requirement-list">
      {requirements.map((requirement) => {
        const status = STATUS[requirement.status];

        return (
          <li key={requirement.key} className={`requirement ${status.className}`}>
            <div className="requirement__status">{status.word}</div>
            <div className="requirement__body">
              <div className="requirement__label">{requirement.label}</div>
              <p className="requirement__detail">{requirement.detail}</p>
            </div>
            <div className="requirement__source">{requirement.source}</div>
          </li>
        );
      })}
    </ol>
  );
}
