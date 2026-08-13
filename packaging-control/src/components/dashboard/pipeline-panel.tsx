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
    stages: PipelineStage[];
    blockedItems: Array<{
      id: string;
      itemKey: string;
      name: string;
      projectCode: string;
      readinessScore: number;
      status: string;
      firstMissingMilestone: string;
    }>;
  };
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

export function PipelinePanel({ pipeline }: PipelinePanelProps) {
  if (!pipeline.itemsEvaluated) {
    return (
      <SectionCard title="Pipeline operativo" description="Cobertura de cada hito del ciclo de vida.">
        <p className="muted-text">Todavía no hay componentes cargados para evaluar.</p>
      </SectionCard>
    );
  }

  return (
    <div className="stack-lg">
      <SectionCard
        title="Pipeline operativo"
        description={`Cobertura de cada hito sobre ${pipeline.itemsEvaluated} componentes. El porcentaje se calcula sobre los componentes a los que el hito aplica.`}
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

      <SectionCard
        title="Componentes trabados"
        description="Ordenados por readiness. Se muestra el primer hito faltante en orden operativo."
        action={
          <Link href="/project-items" className="text-link">
            Ver todos
          </Link>
        }
      >
        {pipeline.blockedItems.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Componente</th>
                  <th>Proyecto</th>
                  <th>Trabado en</th>
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
                    <td>{item.projectCode}</td>
                    <td>{item.firstMissingMilestone}</td>
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
