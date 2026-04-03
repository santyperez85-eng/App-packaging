import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";

function formatDate(value?: Date | string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(value));
}

type ProjectsTableProps = {
  projects: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    healthScore: number;
    macroStatus?: string | null;
    targetLaunchDate?: Date | null;
    product?: { name: string; presentation?: string | null } | null;
    _count?: { projectItems: number; alerts: number };
  }>;
};

export function ProjectsTable({ projects }: ProjectsTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Proyecto</th>
            <th>Producto</th>
            <th>Estado</th>
            <th>Health</th>
            <th>Items</th>
            <th>Alertas</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>
                <Link href={`/projects/${project.id}`} className="table-link">
                  {project.code}
                </Link>
                <div className="table-subtitle">{project.name}</div>
              </td>
              <td>
                <div>{project.product?.name ?? "Sin producto"}</div>
                <div className="table-subtitle">{project.product?.presentation ?? project.macroStatus}</div>
              </td>
              <td>
                <StatusBadge label={project.status} />
              </td>
              <td>{project.healthScore}</td>
              <td>{project._count?.projectItems ?? 0}</td>
              <td>{project._count?.alerts ?? 0}</td>
              <td>{formatDate(project.targetLaunchDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
