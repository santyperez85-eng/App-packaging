import Link from "next/link";

import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";

type PipelineStage = {
  key: string;
  label: string;
  ready: number;
  partial: number;
  missing: number;
  notApplicable: number;
  total: number;
  coveragePercent: number | null;
};

type PipelinePanelProps = {
  pipeline: {
    itemsEvaluated: number;
    readyToClose: number;
    stages: PipelineStage[];
    blockedItems: Array<{
      id: string;
      itemKey: string;
      name: string;
      projectCode: string;
      readinessScore: number;
      status: string;
      missingRequirements: string[];
      atRiskRequirements: string[];
      readyToClose: boolean;
    }>;
  };
  /** Titulo del pipeline. Cambia segun si el alcance es global o un proyecto. */
  title?: string;
  /** La columna Proyecto es redundante cuando el pipeline ya esta acotado a uno. */
  showProjectColumn?: boolean;
  /** Link "Ver todos" del bloque de trabados. `null` lo oculta. */
  viewAllHref?: string | null;
};

function coverageTone(percent: number | null) {
  if (percent === null) {
    return "neutral";
  }

  if (percent >= 80) {
    return "success";
  }

  if (percent >= 40) {
    return "warning";
  }

  return "danger";
}

/**
 * Cobertura por hito. Se usa sola en la pagina de proyecto (donde la tabla de
 * items ya dice donde esta trabado cada componente) y dentro de PipelinePanel
 * en la vista ejecutiva.
 */
export function PipelineStagesCard({
  pipeline,
  title = "Pipeline operativo"
}: Pick<PipelinePanelProps, "pipeline" | "title">) {
  if (!pipeline.itemsEvaluated) {
    return (
      <SectionCard title={title} description="Cobertura de cada hito del ciclo de vida.">
        <p className="muted-text">Todavía no hay componentes cargados para evaluar.</p>
      </SectionCard>
    );
  }

  const componentLabel = pipeline.itemsEvaluated === 1 ? "componente" : "componentes";

  return (
    <SectionCard
      title={title}
      description={`Cobertura de cada hito sobre ${pipeline.itemsEvaluated} ${componentLabel}. El porcentaje se calcula sobre los componentes a los que el hito aplica.`}
    >
      <div className="pipeline-grid">
        {pipeline.stages.map((stage) => {
          const applicable = stage.total - stage.notApplicable;

          return (
            <article key={stage.key} className="pipeline-stage">
              <header>
                <h3>{stage.label}</h3>
                <span
                  className={`pipeline-stage__percent pipeline-stage__percent--${coverageTone(stage.coveragePercent)}`}
                  title={stage.coveragePercent === null ? "El hito no aplica a ningún componente en esta fase" : undefined}
                >
                  {stage.coveragePercent === null ? "n/a" : `${stage.coveragePercent}%`}
                </span>
              </header>

              <div className="pipeline-bar" role="img" aria-label={`${stage.ready} cubiertos, ${stage.partial} parciales, ${stage.missing} faltantes`}>
                {stage.ready > 0 ? (
                  <span className="pipeline-bar__segment pipeline-bar__segment--ready" style={{ flexGrow: stage.ready }} />
                ) : null}
                {stage.partial > 0 ? (
                  <span className="pipeline-bar__segment pipeline-bar__segment--partial" style={{ flexGrow: stage.partial }} />
                ) : null}
                {stage.missing > 0 ? (
                  <span className="pipeline-bar__segment pipeline-bar__segment--missing" style={{ flexGrow: stage.missing }} />
                ) : null}
                {applicable === 0 ? <span className="pipeline-bar__segment pipeline-bar__segment--na" style={{ flexGrow: 1 }} /> : null}
              </div>

              <dl className="pipeline-legend">
                <div>
                  <dt>Cubiertos</dt>
                  <dd>{stage.ready}</dd>
                </div>
                <div>
                  <dt>Parciales</dt>
                  <dd>{stage.partial}</dd>
                </div>
                <div>
                  <dt>Faltantes</dt>
                  <dd>{stage.missing}</dd>
                </div>
                {stage.notApplicable > 0 ? (
                  <div>
                    <dt>No aplica</dt>
                    <dd>{stage.notApplicable}</dd>
                  </div>
                ) : null}
              </dl>
            </article>
          );
        })}
      </div>
    </SectionCard>
  );
}

export function PipelinePanel({
  pipeline,
  title = "Pipeline operativo",
  showProjectColumn = true,
  viewAllHref = "/project-items"
}: PipelinePanelProps) {
  if (!pipeline.itemsEvaluated) {
    return <PipelineStagesCard pipeline={pipeline} title={title} />;
  }

  return (
    <div className="stack-lg">
      <PipelineStagesCard pipeline={pipeline} title={title} />

      <SectionCard
        title="Componentes sin cerrar"
        description="Qué le falta a cada componente para poder darse por cerrado. El orden en que se completen no importa; sí que estén todos."
        action={
          viewAllHref ? (
            <Link href={viewAllHref} className="text-link">
              Ver todos
            </Link>
          ) : null
        }
      >
        {pipeline.blockedItems.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Componente</th>
                  {showProjectColumn ? <th>Proyecto</th> : null}
                  <th>Qué falta</th>
                  <th>Readiness</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.blockedItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link className="table-link" href={`/project-items/${item.id}`}>
                        {item.itemKey}
                      </Link>
                      <div className="table-subtitle">{item.name}</div>
                    </td>
                    {showProjectColumn ? <td>{item.projectCode}</td> : null}
                    <td>
                      <div>{item.missingRequirements.join(" · ") || "—"}</div>
                      {item.atRiskRequirements.length ? (
                        <div className="table-subtitle">A revisar: {item.atRiskRequirements.join(" · ")}</div>
                      ) : null}
                    </td>
                    <td>{item.readinessScore}</td>
                    <td>
                      <StatusBadge label={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">Ningún componente tiene hitos faltantes.</p>
        )}
      </SectionCard>
    </div>
  );
}
