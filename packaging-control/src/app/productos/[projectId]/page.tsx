import Link from "next/link";
import { notFound } from "next/navigation";

import { AlertsTable } from "@/components/alerts/alerts-table";
import { ClosureMatrix, PendingByRequirement } from "@/components/portfolio/closure-matrix";
import { LaunchDateField } from "@/components/portfolio/launch-date-field";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { labels, plural } from "@/lib/labels";
import { portfolioService } from "@/server/services/portfolio-service";
import { projectsService } from "@/server/services/projects-service";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [product, project] = await Promise.all([
    portfolioService.getProduct(projectId),
    projectsService.getProjectDetail(projectId).catch(() => null)
  ]);

  if (!product || !project) {
    notFound();
  }

  const pendingComponents = product.totalComponents - product.closedComponents;

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <h1>{product.displayName}</h1>
        <p>
          {product.presentation ?? "Sin presentación declarada"}
          {product.activeIngredient ? ` · ${product.activeIngredient}` : ""}
        </p>

        <div className="pill-row">
          <StatusBadge label={labels.projectStatus(product.status)} />
          <LaunchDateField projectId={product.id} value={product.launchDate} />
        </div>

        <p className="page-intro__summary">
          {product.totalComponents === 0
            ? "Todavía no se derivó ningún componente de packaging de la planilla de este producto."
            : product.readyToClose
              ? `Los ${product.totalComponents} componentes cumplen todos los requisitos. El producto se puede dar por cerrado.`
              : `${product.closedComponents} de ${product.totalComponents} componentes están cerrados. A los otros ${pendingComponents} les falta algo.`}
        </p>
      </section>

      {product.attention.length ? (
        <SectionCard
          title="Necesita una decisión tuya"
          description="No dependen de que responda otro sector."
        >
          <div className="list-stack">
            {product.attention.map((entry, index) => (
              <div key={index} className="list-row">
                <div>
                  <div className="list-row__title">{entry.componentName}</div>
                  <div className="list-row__subtitle">{entry.detail}</div>
                </div>
                <div className="list-row__meta">
                  <span className="status-badge status-badge--warning">{entry.requirement}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Requisitos de cierre"
        description="Los seis requisitos que tiene que cumplir cada componente. El orden en que se completen no importa; sí que estén todos. Pasá el mouse sobre una celda para ver qué se encontró en cada fuente."
      >
        <ClosureMatrix components={product.components} />
      </SectionCard>

      {pendingComponents > 0 ? (
        <SectionCard
          title="Qué falta"
          description="Lo pendiente agrupado por requisito, para saber qué reclamar y a quién."
        >
          <PendingByRequirement components={product.components} />
        </SectionCard>
      ) : null}

      <div className="grid-two">
        <SectionCard
          title="Estructura en receta"
          description={`${plural(project.bomItems.length, "componente")} de packaging cargados en la receta.`}
        >
          {project.bomItems.length ? (
            <div className="list-stack">
              {project.bomItems.map((item) => (
                <div key={item.id} className="list-row">
                  <div>
                    <div className="list-row__title">{item.componentName}</div>
                    <div className="list-row__subtitle">{labels.componentSlot(item.componentType)}</div>
                  </div>
                  <div className="list-row__meta">
                    <span className="muted-text">{item.expectedMaterialCode ?? "Sin código"}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">
              Este producto todavía no tiene estructura cargada. El registro de recetas empezó hace poco, así que
              muchos productos en curso todavía no figuran.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Altas de código"
          description={`${plural(project.materialRequests.length, "pedido")} de código registrados.`}
        >
          {project.materialRequests.length ? (
            <div className="list-stack">
              {project.materialRequests.map((request) => (
                <div key={request.id} className="list-row">
                  <div>
                    <div className="list-row__title">{request.requestedDescription}</div>
                    <div className="list-row__subtitle">Pedido {request.requestCode ?? "sin número"}</div>
                  </div>
                  <div className="list-row__meta">
                    <StatusBadge label={labels.requestStatus(request.requestStatus)} />
                    <span className="muted-text">{request.linkedMaterialCode ?? "Sin código asignado"}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">No hay ningún pedido de código registrado para este producto.</p>
          )}
        </SectionCard>
      </div>

      {project.alerts.length ? (
        <SectionCard
          title="Avisos sin resolver"
          description="Inconsistencias que las reglas detectaron entre las fuentes."
          action={
            <Link href="/avisos" className="text-link">
              Ver todos
            </Link>
          }
        >
          <AlertsTable alerts={project.alerts} showProject={false} />
        </SectionCard>
      ) : null}
    </div>
  );
}
