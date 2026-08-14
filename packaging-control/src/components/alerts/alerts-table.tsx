import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";

function formatDate(value?: Date | string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(value));
}

type AlertsTableProps = {
  alerts: Array<{
    id: string;
    title: string;
    message: string;
    severity: string;
    status: string;
    project?: { code: string } | null;
    projectItem?: { id?: string | null; itemKey?: string | null; name: string } | null;
    createdAt: Date;
  }>;
  /** La columna Proyecto es redundante cuando la tabla ya esta dentro de uno. */
  showProject?: boolean;
};

export function AlertsTable({ alerts, showProject = true }: AlertsTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Alerta</th>
            {showProject ? <th>Proyecto</th> : null}
            <th>Item</th>
            <th>Severidad</th>
            <th>Estado</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td>
                <div>{alert.title}</div>
                <div className="table-subtitle">{alert.message}</div>
              </td>
              {showProject ? <td>{alert.project?.code ?? "Sin proyecto"}</td> : null}
              <td>
                {alert.projectItem ? (
                  alert.projectItem.id ? (
                    <Link className="table-link" href={`/project-items/${alert.projectItem.id}`}>
                      {alert.projectItem.itemKey ?? alert.projectItem.name}
                    </Link>
                  ) : (
                    (alert.projectItem.itemKey ?? alert.projectItem.name)
                  )
                ) : (
                  <span className="muted-text">Alerta de proyecto</span>
                )}
              </td>
              <td>
                <StatusBadge label={alert.severity} />
              </td>
              <td>
                <StatusBadge label={alert.status} />
              </td>
              <td>{formatDate(alert.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
