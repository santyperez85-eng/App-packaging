import { notFound } from "next/navigation";

import { AlertsTable } from "@/components/alerts/alerts-table";
import { PipelineStagesCard } from "@/components/dashboard/pipeline-panel";
import { ProjectItemsTable } from "@/components/project-items/project-items-table";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { dashboardService } from "@/server/services/dashboard-service";
import { projectsService } from "@/server/services/projects-service";

export const dynamic = "force-dynamic";

function formatDate(value?: Date | string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(value));
}

export default async function ProjectDetailPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await projectsService.getProjectDetail(projectId).catch(() => null);

  if (!project) {
    notFound();
  }

  // Mismo calculo de hitos que la vista ejecutiva, acotado a este proyecto.
  const pipeline = await dashboardService.getPipelineSnapshot({
    projectId: project.id,
    blockedItemsLimit: project.projectItems.length || 1
  });
  const blockedByMilestone = Object.fromEntries(
    pipeline.blockedItems.map((item) => [item.id, item.firstMissingMilestone])
  );

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <span className="eyebrow">{project.code}</span>
        <h1>{project.name}</h1>
        <p>
          {project.product?.name ?? "Sin producto"} · {project.product?.presentation ?? "Sin presentación"}
        </p>
        <div className="pill-row">
          <StatusBadge label={project.status} />
          <span className="metric-pill">Health {project.healthScore}</span>
          <span className="metric-pill">Target {formatDate(project.targetLaunchDate)}</span>
        </div>
      </section>

      <div className="stats-grid">
        <StatCard label="Project items" value={project.projectItems.length} />
        <StatCard label="BOM packaging" value={project.bomItems.length} />
        <StatCard label="Pedidos de código" value={project.materialRequests.length} />
        <StatCard label="Alertas abiertas" value={project.alerts.length} accent={project.alerts.length ? "danger" : "success"} />
      </div>

      <PipelineStagesCard pipeline={pipeline} title="Pipeline del proyecto" />

      <SectionCard
        title="Project items"
        description="Componentes de packaging vinculados al proyecto. La columna Trabado en muestra el primer hito faltante en orden operativo."
      >
        <ProjectItemsTable items={project.projectItems} blockedByMilestone={blockedByMilestone} />
      </SectionCard>

      <div className="grid-two">
        <SectionCard title="BOM packaging" description="Componentes esperados para lanzamiento o cambio.">
          <div className="list-stack">
            {project.bomItems.map((item) => (
              <div key={item.id} className="list-row">
                <div>
                  <div className="list-row__title">{item.componentKey}</div>
                  <div className="list-row__subtitle">{item.componentName}</div>
                </div>
                <div className="list-row__meta">
                  <span className="metric-pill">{item.componentType}</span>
                  <span className="muted-text">{item.expectedMaterialCode ?? "Sin material esperado"}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Pedidos de código" description="Solicitudes operativas ligadas al proyecto.">
          <div className="list-stack">
            {project.materialRequests.map((request) => (
              <div key={request.id} className="list-row">
                <div>
                  <div className="list-row__title">{request.requestCode ?? "Sin código"}</div>
                  <div className="list-row__subtitle">{request.requestedDescription}</div>
                </div>
                <div className="list-row__meta">
                  <StatusBadge label={request.requestStatus} />
                  <span className="muted-text">{request.linkedMaterialCode ?? "Sin material vinculado"}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Alertas abiertas" description="Inconsistencias y bloqueos del proyecto.">
        <AlertsTable alerts={project.alerts} showProject={false} />
      </SectionCard>
    </div>
  );
}
