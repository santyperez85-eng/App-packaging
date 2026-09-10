import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { labels, type Label } from "@/lib/labels";
import type { projectItemLifecycleService } from "@/server/services/project-item-lifecycle-service";

type LifecycleReadModel = Awaited<ReturnType<typeof projectItemLifecycleService.getProjectItemLifecycle>>;

type EvidenceEntry = LifecycleReadModel["evidences"]["primary"][number];

const MILESTONE_STATUS_LABELS: Record<string, Label> = {
  ready: { text: "Cubierto", tone: "success" },
  partial: { text: "A medias", tone: "warning" },
  missing: { text: "Falta", tone: "danger" },
  manual_review: { text: "Necesita que decidas vos", tone: "warning" },
  not_required: { text: "No hace falta", tone: "neutral" },
  not_integrated: { text: "Todavía no corresponde", tone: "neutral" }
};

const EVENT_KIND_LABELS: Record<string, string> = {
  EXPECTATION_DEFINED: "Lo pidió la planilla del PM",
  CODE_REQUESTED: "Se pidió el código",
  PRE_BOM_STRUCTURE_EVIDENCED: "Apareció en la estructura",
  ALERT_OPEN: "Se abrió un aviso",
  ALERT_RESOLVED: "Se resolvió el aviso",
  CURRENT_STATE: "Estado de hoy"
};

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (parsed.getTime() <= 0) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function milestoneStatusBadge(status: string) {
  return <StatusBadge label={MILESTONE_STATUS_LABELS[status] ?? { text: status, tone: "neutral" }} />;
}

function EvidenceList({ entries, emptyLabel }: { entries: EvidenceEntry[]; emptyLabel: string }) {
  if (!entries.length) {
    return <p className="muted-text">{emptyLabel}</p>;
  }

  return (
    <div className="list-stack">
      {entries.map((evidence) => (
        <div key={evidence.id} className="list-row">
          <div>
            <div className="list-row__title">{evidence.rawLabel ?? evidence.sourceRecordKey}</div>
            <div className="list-row__subtitle">
              {labels.source(evidence.sourceType)} · {evidence.sourceRecordKey}
            </div>
          </div>
          <div className="list-row__meta">
            <StatusBadge label={labels.matchingStatus(evidence.matchStatus)} />
            <span className="muted-text">Visto {formatDate(evidence.lastSeenAt ?? evidence.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * El detalle tecnico de un componente.
 *
 * `embedded` lo muestra dentro de la ficha del componente, debajo del
 * checklist: ahi el encabezado ya lo puso la pagina y repetirlo confunde.
 */
export function ProjectItemLifecycleView({
  lifecycle,
  embedded = false
}: {
  lifecycle: LifecycleReadModel;
  embedded?: boolean;
}) {
  const { project, item, derivedState, milestones, evidences, timeline, alerts, inconsistencies, reconstructionGaps, documentation } =
    lifecycle;

  return (
    <div className="stack-lg">
      {embedded ? null : (
        <section className="page-intro">
          <span className="eyebrow">
            {project.code} · {item.itemKey}
          </span>
          <h1>{item.name}</h1>
          <p>Reconstruido desde la planilla del PM, las fuentes operativas y los avisos que se dispararon.</p>
          <div className="pill-row">
            <StatusBadge label={labels.itemStatus(item.status)} />
            <span className="metric-pill">{labels.componentSlot(item.componentSlot)}</span>
            <StatusBadge label={labels.matchingStatus(item.matchingStatus)} />
          </div>
        </section>
      )}

      <div className="stats-grid stats-grid--four">
        <StatCard
          label="Avisos críticos sin resolver"
          value={derivedState.openCriticalAlerts}
          accent={derivedState.openCriticalAlerts ? "danger" : "success"}
        />
        <StatCard
          label="Avisos de atención"
          value={derivedState.openWarningAlerts}
          accent={derivedState.openWarningAlerts ? "warning" : "success"}
        />
        <StatCard
          label="Pasos sin cubrir"
          value={derivedState.missingMilestones.length}
          hint={derivedState.partialMilestones.length ? `${derivedState.partialMilestones.length} a medias` : undefined}
          accent={derivedState.missingMilestones.length ? "warning" : "success"}
        />
        <StatCard label="Cómo se vinculó" value={labels.matchingStatus(item.matchingStatus).text} />
      </div>

      <SectionCard
        title="Recorrido del componente"
        description="Cómo se fue armando, según lo que dejó registrado cada fuente. No es el checklist de cierre: es la traza de lo que pasó."
      >
        <div className="milestone-grid">
          {milestones.map((milestone) => (
            <article key={milestone.key} className="milestone-card">
              <header className="milestone-card__header">
                <h3>{milestone.label}</h3>
                {milestoneStatusBadge(milestone.status)}
              </header>
              <p>{milestone.reason}</p>
              <div className="pill-row">
                {milestone.evidenceRefs.map((ref) => (
                  <span key={`${ref.sourceType}:${ref.sourceRecordKey}`} className="metric-pill">
                    {labels.source(ref.sourceType)}
                  </span>
                ))}
                {milestone.alertRefs.map((ref, index) => (
                  <StatusBadge key={`${ref.ruleCode ?? "alert"}:${index}`} label={labels.alertStatus(ref.status)} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Historia" description="Lo que fue pasando con este componente, en orden.">
        <ol className="timeline">
          {timeline.map((event) => (
            <li key={event.sequence} className="timeline__entry">
              <span className="timeline__marker">{event.sequence}</span>
              <div className="timeline__body">
                <div className="timeline__heading">
                  <span className="list-row__title">{event.title}</span>
                  <div className="list-row__meta">
                    {event.severity ? <StatusBadge label={labels.severity(event.severity)} /> : null}
                    {event.status ? <StatusBadge label={labels.eventStatus(event.status)} /> : null}
                  </div>
                </div>
                <div className="list-row__subtitle">
                  {EVENT_KIND_LABELS[event.kind] ?? event.kind} · {formatDate(event.occurredAt)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <div className="grid-two">
        <SectionCard title="Lo que declaró la planilla del PM" description="La fuente que define qué componentes tiene que tener el producto.">
          <EvidenceList entries={evidences.primary} emptyLabel="La planilla del PM no dejó registro de este componente." />
        </SectionCard>

        <SectionCard title="Lo que aportaron las otras fuentes" description="Altas de código, recetas, SAP y Moondesk.">
          <EvidenceList entries={evidences.secondary} emptyLabel="Ninguna otra fuente menciona este componente todavía." />
        </SectionCard>
      </div>

      <SectionCard title="Avisos de este componente" description="Lo que detectaron las reglas al cruzar las fuentes.">
        {alerts.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Aviso</th>
                  <th>Gravedad</th>
                  <th>Estado</th>
                  <th>Creada</th>
                  <th>Resuelta</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <div>{alert.title}</div>
                      <div className="table-subtitle">{alert.message}</div>
                    </td>
                    <td>
                      <StatusBadge label={labels.severity(alert.severity)} />
                    </td>
                    <td>
                      <StatusBadge label={labels.alertStatus(alert.status)} />
                    </td>
                    <td>{formatDate(alert.createdAt)}</td>
                    <td>{formatDate(alert.resolvedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">Este componente no tiene ningún aviso.</p>
        )}
      </SectionCard>

      {documentation ? (
        <SectionCard
          title="Diseño y aprobación en Moondesk"
          description="Revisiones y tiempos tomados de los reportes de Moondesk."
        >
          <div className="stats-grid stats-grid--four">
            <StatCard label="Vueltas de revisión" value={documentation.metrics.reviewCount} />
            <StatCard label="Rehechos" value={documentation.metrics.reprocessCount ?? "—"} accent={documentation.metrics.reprocessCount ? "warning" : "default"} />
            <StatCard label="Días de revisión" value={documentation.metrics.reviewDays ?? "—"} />
            <StatCard label="Días de diseño" value={documentation.metrics.designDays ?? "—"} />
          </div>

          {documentation.reviews.length ? (
            <div className="table-wrap" style={{ marginTop: "16px" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Revisor</th>
                    <th>Rol</th>
                    <th>Decisión</th>
                    <th>Días hábiles</th>
                    <th>Inicio</th>
                    <th>Fin</th>
                  </tr>
                </thead>
                <tbody>
                  {documentation.reviews.map((review, index) => (
                    <tr key={`${review.reviewer}:${index}`}>
                      <td>{review.reviewer ?? "Sin revisor"}</td>
                      <td>{review.role ?? "—"}</td>
                      <td>
                        <StatusBadge label={labels.alertStatus(review.decision)} />
                      </td>
                      <td>{review.workingDays ?? "—"}</td>
                      <td>{formatDate(review.startedAt)}</td>
                      <td>{formatDate(review.reviewedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted-text">Moondesk no registra revisiones para este componente.</p>
          )}

          <div className="list-stack" style={{ marginTop: "16px" }}>
            {documentation.tasks.map((task, index) => (
              <div key={`${task.sourceTaskNumber}:${index}`} className="list-row">
                <div>
                  <div className="list-row__title">{task.title}</div>
                  <div className="list-row__subtitle">
                    {task.documents.map((document) => `${document.documentType}${document.approved ? " ✓" : ""}`).join(" · ") || "Sin documentos"}
                  </div>
                </div>
                <div className="list-row__meta">
                  <StatusBadge label={{ text: task.taskStatus, tone: "neutral" }} />
                  {task.latestVersionLabel ? <span className="metric-pill">v{task.latestVersionLabel}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <div className="grid-two">
        <SectionCard title="Datos que no cierran entre sí" description="Diferencias entre lo que dice una fuente y otra.">
          {inconsistencies.length ? (
            <div className="list-stack">
              {inconsistencies.map((entry, index) => (
                <div key={`${entry.key}:${index}`} className="list-row">
                  <div>
                    <div className="list-row__title">{entry.key}</div>
                    <div className="list-row__subtitle">{entry.message}</div>
                  </div>
                  <div className="list-row__meta">
                    <StatusBadge label={labels.severity(String(entry.severity))} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">Las fuentes coinciden entre sí.</p>
          )}
        </SectionCard>

        <SectionCard
          title="Lo que no se puede saber"
          description="Detalle que ninguna fuente registra, así que la app no lo puede afirmar."
        >
          {reconstructionGaps.length ? (
            <div className="list-stack">
              {reconstructionGaps.map((gap) => (
                <div key={gap.key} className="list-row">
                  <div>
                    <div className="list-row__title">{gap.key}</div>
                    <div className="list-row__subtitle">{gap.message}</div>
                    <div className="list-row__subtitle">Consecuencia: {gap.consequence}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">No falta nada: la historia se reconstruye completa.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
