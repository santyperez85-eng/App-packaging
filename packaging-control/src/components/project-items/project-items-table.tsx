import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";

type ProjectItemsTableProps = {
  items: Array<{
    id: string;
    itemKey: string;
    name: string;
    status: string;
    readinessScore: number;
    criticality: string;
    project?: { code: string } | null;
    materialMaster?: { materialCode: string } | null;
    expectedMaterialCode?: string | null;
    alerts?: Array<{ id: string; severity: string; title: string }>;
  }>;
  showProject?: boolean;
  /**
   * Requisitos de cierre pendientes por item id. Cuando se pasa, la tabla agrega
   * la columna "Qué falta" para no tener que abrir el lifecycle. Un item que no
   * figura en el mapa no tiene faltantes.
   */
  missingByItem?: Record<string, string>;
};

export function ProjectItemsTable({ items, showProject = false, missingByItem }: ProjectItemsTableProps) {
  const showMissingColumn = Boolean(missingByItem);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {showProject ? <th>Proyecto</th> : null}
            <th>Item</th>
            <th>Estado</th>
            {showMissingColumn ? <th>Qué falta</th> : null}
            <th>Readiness</th>
            <th>Criticidad</th>
            <th>Material</th>
            <th>Alertas</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {showProject ? <td>{item.project?.code ?? "Sin proyecto"}</td> : null}
              <td>
                <Link className="table-link" href={`/project-items/${item.id}`}>
                  {item.itemKey}
                </Link>
                <div className="table-subtitle">{item.name}</div>
              </td>
              <td>
                <StatusBadge label={item.status} />
              </td>
              {showMissingColumn ? (
                <td>
                  {missingByItem?.[item.id] || <span className="muted-text">Listo para cerrar</span>}
                </td>
              ) : null}
              <td>{item.readinessScore}</td>
              <td>{item.criticality}</td>
              <td>{item.materialMaster?.materialCode ?? item.expectedMaterialCode ?? "Pendiente"}</td>
              <td>{item.alerts?.length ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
