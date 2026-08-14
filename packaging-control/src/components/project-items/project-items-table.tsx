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
   * Primer hito faltante por item id, en orden operativo. Cuando se pasa, la
   * tabla agrega la columna "Trabado en" para no tener que abrir el lifecycle.
   */
  blockedByMilestone?: Record<string, string>;
};

export function ProjectItemsTable({ items, showProject = false, blockedByMilestone }: ProjectItemsTableProps) {
  const showBlockedColumn = Boolean(blockedByMilestone);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {showProject ? <th>Proyecto</th> : null}
            <th>Item</th>
            <th>Estado</th>
            {showBlockedColumn ? <th>Trabado en</th> : null}
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
              {showBlockedColumn ? (
                <td>
                  {blockedByMilestone?.[item.id] ?? <span className="muted-text">Sin hitos faltantes</span>}
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
