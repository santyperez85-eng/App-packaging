import Link from "next/link";
import { notFound } from "next/navigation";

import { ComponentChecklist } from "@/components/portfolio/component-checklist";
import { ProjectItemLifecycleView } from "@/components/project-items/project-item-lifecycle-view";
import { SectionCard } from "@/components/ui/section-card";
import { labels } from "@/lib/labels";
import { portfolioService } from "@/server/services/portfolio-service";
import { projectItemLifecycleService } from "@/server/services/project-item-lifecycle-service";

export const dynamic = "force-dynamic";

export default async function ComponentDetailPage({
  params
}: {
  params: Promise<{ projectItemId: string }>;
}) {
  const { projectItemId } = await params;
  const [detail, lifecycle] = await Promise.all([
    portfolioService.getComponent(projectItemId),
    projectItemLifecycleService.getProjectItemLifecycle(projectItemId).catch(() => null)
  ]);

  if (!detail) {
    notFound();
  }

  const { component, product } = detail;
  const pending = component.applicable - component.met;

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <span className="eyebrow">
          <Link className="text-link" href={`/productos/${product.id}`}>
            {product.displayName}
          </Link>
          {product.presentation ? ` · ${product.presentation}` : ""}
        </span>
        <h1>{component.name}</h1>
        <p className="page-intro__summary">
          {component.closed
            ? "Cumple todos los requisitos: se puede dar por cerrado."
            : pending === 1
              ? "Le falta un solo requisito para poder cerrarse."
              : `Le faltan ${pending} de ${component.applicable} requisitos.`}
        </p>

        {/* El estado heredado ("espera documentos") no se muestra: el checklist
            de abajo dice exactamente que falta, y los dos juntos se contradecian. */}
        <div className="pill-row">
          <span className="metric-pill">{labels.componentSlot(component.slot)}</span>
          <span className="metric-pill">{component.materialCode ?? "Sin código de material"}</span>
        </div>
      </section>

      <SectionCard
        title="Requisitos de cierre"
        description="Qué se encontró en cada fuente. No hay un orden obligatorio entre ellos."
      >
        <ComponentChecklist requirements={component.requirements} />
      </SectionCard>

      {lifecycle ? (
        <details className="deep-dive">
          <summary>
            Detalle técnico
            <span className="deep-dive__hint">
              De dónde salió cada dato, historia del componente y reglas que se dispararon
            </span>
          </summary>
          <div className="deep-dive__body">
            <ProjectItemLifecycleView lifecycle={lifecycle} embedded />
          </div>
        </details>
      ) : null}
    </div>
  );
}
