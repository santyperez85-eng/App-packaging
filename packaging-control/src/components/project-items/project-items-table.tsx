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
};

export function ProjectItemsTable({ items, showProject = false }: ProjectItemsTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {showProject ? <th>Proyecto</th> : null}
            <th>Item</th>
            <th>Estado</th>
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
