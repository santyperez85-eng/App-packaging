import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatShortDate, labels } from "@/lib/labels";

type AlertsTableProps = {
  alerts: Array<{
    id: string;
    title: string;
    message: string;
    severity: string;
    status: string;
    project?: { code: string; name?: string | null; product?: { name: string } | null } | null;
    projectItem?: { id?: string | null; itemKey?: string | null; name: string } | null;
    createdAt: Date;
  }>;
  /** La columna Producto es redundante cuando la tabla ya esta dentro de uno. */
  showProject?: boolean;
};

export function AlertsTable({ alerts, showProject = true }: AlertsTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Aviso</th>
            {showProject ? <th>Producto</th> : null}
            <th>Componente</th>
            <th>Gravedad</th>
            <th>Desde</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td>
                <div>{alert.title}</div>
                <div className="table-subtitle">{alert.message}</div>
              </td>
              {showProject ? (
                <td>{alert.project?.product?.name ?? alert.project?.name ?? "Sin producto"}</td>
              ) : null}
              <td>
                {alert.projectItem ? (
                  alert.projectItem.id ? (
                    <Link className="table-link" href={`/componentes/${alert.projectItem.id}`}>
                      {alert.projectItem.name}
                    </Link>
                  ) : (
                    alert.projectItem.name
                  )
                ) : (
                  <span className="muted-text">Es del producto entero</span>
                )}
              </td>
              <td>
                <StatusBadge label={labels.severity(alert.severity)} />
              </td>
              <td>{formatShortDate(alert.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
