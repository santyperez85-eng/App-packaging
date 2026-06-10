import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { projectItemLifecycleService } from "@/server/services/project-item-lifecycle-service";

type LifecycleReadModel = Awaited<ReturnType<typeof projectItemLifecycleService.getProjectItemLifecycle>>;

type EvidenceEntry = LifecycleReadModel["evidences"]["primary"][number];

const MILESTONE_STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ready: { label: "Cubierto", tone: "success" },
  partial: { label: "Parcial", tone: "warning" },
  missing: { label: "Faltante", tone: "danger" },
  manual_review: { label: "Revisión manual", tone: "warning" },
  not_required: { label: "No requerido", tone: "neutral" },
  not_integrated: { label: "Fuera de fase", tone: "neutral" }
};

const HEALTH_CONTRIBUTION_LABELS: Record<string, string> = {
  ready: "Listo",
  blocked: "Bloqueado",
  incomplete: "Incompleto",
  partial: "Parcial",
  in_progress: "En progreso"
};

const EVENT_KIND_LABELS: Record<string, string> = {
  EXPECTATION_DEFINED: "Expectativa definida",
  CODE_REQUESTED: "Pedido de código",
  PRE_BOM_STRUCTURE_EVIDENCED: "Estructura pre-SAP evidenciada",
  ALERT_OPEN: "Alerta abierta",
  ALERT_RESOLVED: "Alerta resuelta",
  CURRENT_STATE: "Estado actual"
};

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (parsed.getTime() <= 0) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function milestoneStatusBadge(status: string) {
  const entry = MILESTONE_STATUS_LABELS[status] ?? { label: status, tone: "neutral" as const };
  return <span className={`status-badge status-badge--${entry.tone}`}>{entry.label}</span>;
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
              {evidence.sourceType} · {evidence.sourceRecordKey}
            </div>
          </div>
          <div className="list-row__meta">
            <StatusBadge label={evidence.matchStatus} />
            <span className="metric-pill">{evidence.matchRule ?? "Sin regla"}</span>
            <span className="muted-text">Visto {formatDate(evidence.lastSeenAt ?? evidence.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProjectItemLifecycleView({ lifecycle }: { lifecycle: LifecycleReadModel }) {
  const { project, item, derivedState, milestones, evidences, timeline, alerts, inconsistencies, reconstructionGaps } =
    lifecycle;

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <span className="eyebrow">
          {project.code} · {item.itemKey}
        </span>
        <h1>{item.name}</h1>
        <p>Lifecycle operativo reconstruido desde expectativa PM, evidencias, alertas y estado actual.</p>
        <div className="pill-row">
          <StatusBadge label={item.status} />
          <span className="metric-pill">Readiness {item.readinessScore}</span>
          <span className="metric-pill">Slot {item.componentSlot ?? "Sin slot"}</span>
          <span className="metric-pill">Matching {item.matchingStatus}</span>
          <span className="metric-pill">
            Salud: {HEALTH_CONTRIBUTION_LABELS[derivedState.healthContribution] ?? derivedState.healthContribution}
          </span>
        </div>
      </section>

      <div className="stats-grid stats-grid--four">
        <StatCard label="Readiness" value={item.readinessScore} hint={`Estado ${item.status}`} />
        <StatCard
          label="Alertas críticas abiertas"
          value={derivedState.openCriticalAlerts}
          accent={derivedState.openCriticalAlerts ? "danger" : "success"}
        />
        <StatCard
          label="Alertas warning abiertas"
          value={derivedState.openWarningAlerts}
          accent={derivedState.openWarningAlerts ? "warning" : "success"}
        />
        <StatCard
          label="Milestones faltantes"
          value={derivedState.missingMilestones.length}
          hint={derivedState.partialMilestones.length ? `${derivedState.partialMilestones.length} parciales` : undefined}
          accent={derivedState.missingMilestones.length ? "warning" : "success"}
        />
      </div>

      <SectionCard
        title="Milestones operativos"
        description="Hitos del ciclo de vida del componente, en orden operativo."
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
                    {ref.sourceType}
                  </span>
                ))}
                {milestone.alertRefs.map((ref, index) => (
                  <StatusBadge key={`${ref.ruleCode ?? "alert"}:${index}`} label={`${ref.ruleCode ?? "ALERTA"} ${ref.status}`} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Timeline operativo" description="Eventos reconstruidos en orden operativo del componente.">
        <ol className="timeline">
          {timeline.map((event) => (
            <li key={event.sequence} className="timeline__entry">
              <span className="timeline__marker">{event.sequence}</span>
              <div className="timeline__body">
                <div className="timeline__heading">
                  <span className="list-row__title">{event.title}</span>
                  <div className="list-row__meta">
                    {event.severity ? <StatusBadge label={event.severity} /> : null}
                    {event.status ? <StatusBadge label={event.status} /> : null}
                  </div>
                </div>
                <div className="list-row__subtitle">
                  {EVENT_KIND_LABELS[event.kind] ?? event.kind} · {event.stage} · {formatDate(event.occurredAt)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <div className="grid-two">
        <SectionCard title="Evidencia primaria" description="Expectativa PM y evidencias primarias del item.">
          <EvidenceList entries={evidences.primary} emptyLabel="Sin evidencia primaria persistida." />
        </SectionCard>

        <SectionCard title="Evidencia secundaria" description="Altas, BOM/Recetas y otras fuentes operativas.">
          <EvidenceList entries={evidences.secondary} emptyLabel="Sin evidencia secundaria persistida." />
        </SectionCard>
      </div>

      <SectionCard title="Alertas del item" description="Alertas abiertas y resueltas asociadas al componente.">
        {alerts.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Alerta</th>
                  <th>Regla</th>
                  <th>Dimensión</th>
                  <th>Severidad</th>
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
                    <td>{alert.ruleCode ?? "Sin regla"}</td>
                    <td>{alert.dimension ?? "Sin dimensión"}</td>
                    <td>
                      <StatusBadge label={alert.severity} />
                    </td>
                    <td>
                      <StatusBadge label={alert.status} />
                    </td>
                    <td>{formatDate(alert.createdAt)}</td>
                    <td>{formatDate(alert.resolvedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">El item no tiene alertas asociadas.</p>
        )}
      </SectionCard>

      <div className="grid-two">
        <SectionCard title="Inconsistencias" description="Señales que requieren revisión o atención operativa.">
          {inconsistencies.length ? (
            <div className="list-stack">
              {inconsistencies.map((entry, index) => (
                <div key={`${entry.key}:${index}`} className="list-row">
                  <div>
                    <div className="list-row__title">{entry.key}</div>
                    <div className="list-row__subtitle">{entry.message}</div>
                  </div>
                  <div className="list-row__meta">
                    <StatusBadge label={String(entry.severity)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">Sin inconsistencias detectadas.</p>
          )}
        </SectionCard>

        <SectionCard
          title="Huecos de reconstrucción"
          description="Detalle operativo que el estado persistido no permite reconstruir."
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
            <p className="muted-text">El lifecycle se reconstruye completo desde el estado persistido.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
