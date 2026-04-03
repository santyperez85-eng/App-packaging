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
    projectItem?: { name: string } | null;
    createdAt: Date;
  }>;
};

export function AlertsTable({ alerts }: AlertsTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Alerta</th>
            <th>Proyecto</th>
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
              <td>{alert.project?.code ?? "Sin proyecto"}</td>
              <td>{alert.projectItem?.name ?? "Sin item"}</td>
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
