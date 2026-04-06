import Link from "next/link";

import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  FunctionalValidationAlertDiagnostic,
  FunctionalValidationDiagnosticsReport,
  FunctionalValidationDimensionDiagnostic,
  FunctionalValidationItemDiagnostic
} from "@/server/validation/functional-validation-diagnostics-service";

function formatLabel(value: string | null | undefined) {
  if (!value) {
    return "Sin dato";
  }

  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value: Date | string | null | undefined) {
  if (!value) {
    return "Sin dato";
  }

  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires"
  }).format(date);
}

function renderAlertList(alerts: FunctionalValidationAlertDiagnostic[]) {
  if (alerts.length === 0) {
    return <p className="muted-text">Sin alertas generadas por reglas en esta capa.</p>;
  }

  return (
    <div className="qa-substack">
      {alerts.map((alert) => (
        <div key={`${alert.ruleCode}-${alert.title}`} className="qa-inline-card">
          <div className="pill-row">
            <StatusBadge label={alert.severity} />
            <span className="metric-pill">{formatLabel(alert.problemClass)}</span>
            <span className="metric-pill">{formatLabel(alert.dimension ?? "sin_dimension")}</span>
          </div>
          <strong>{alert.title}</strong>
          <p>{alert.message}</p>
        </div>
      ))}
    </div>
  );
}

function renderDimensionCard(dimension: FunctionalValidationDimensionDiagnostic) {
  return (
    <article key={dimension.key} className="qa-inline-card">
      <div className="qa-inline-card__header">
        <div>
          <h3>{dimension.label}</h3>
          <p>{dimension.reason}</p>
        </div>
        <div className="pill-row">
          <StatusBadge label={dimension.status} />
          <span className="metric-pill">Score {dimension.score}</span>
        </div>
      </div>

      {dimension.signals.length > 0 ? (
        <div className="pill-row">
          {dimension.signals.map((signal) => (
            <span key={signal} className="metric-pill">
              {formatLabel(signal)}
            </span>
          ))}
        </div>
      ) : null}

      {renderAlertList(dimension.alerts)}
    </article>
  );
}

function ItemWhyPanel({ item }: { item: FunctionalValidationItemDiagnostic }) {
  return (
    <details className="qa-details">
      <summary className="qa-details__summary">
        <div className="qa-details__summary-copy">
          <strong>{item.name}</strong>
          <span className="muted-text">
            {item.itemKey} · {formatLabel(item.componentSlot)} · {formatLabel(item.originMode)}
          </span>
        </div>

        <div className="pill-row">
          <StatusBadge label={item.status} />
          <span className="metric-pill">Readiness {item.readinessScore}</span>
        </div>
      </summary>

      <div className="qa-details__body">
        <div className="qa-why-grid">
          <section className="qa-why-block">
            <span className="eyebrow">1. Expectativa</span>
            <p>{item.why.expectation.summary}</p>
            <ul className="qa-bullet-list">
              {item.why.expectation.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </section>

          <section className="qa-why-block">
            <span className="eyebrow">2. Matching</span>
            <p>{item.why.matching.summary}</p>
            <ul className="qa-bullet-list">
              {item.why.matching.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </section>

          <section className="qa-why-block">
            <span className="eyebrow">3. Evidencias</span>
            <p>{item.why.evidences.summary}</p>

            <div className="qa-substack">
              <div>
                <strong>Fuentes con evidencia</strong>
                <div className="pill-row qa-pill-wrap">
                  {item.why.evidences.available.length > 0 ? (
                    item.why.evidences.available.map((source) => (
                      <span key={source} className="metric-pill">
                        {source}
                      </span>
                    ))
                  ) : (
                    <span className="muted-text">Sin fuentes cubiertas.</span>
                  )}
                </div>
              </div>

              <div>
                <strong>Fuentes faltantes</strong>
                <div className="pill-row qa-pill-wrap">
                  {item.why.evidences.missing.length > 0 ? (
                    item.why.evidences.missing.map((source) => (
                      <span key={source} className="metric-pill">
                        {source}
                      </span>
                    ))
                  ) : (
                    <span className="muted-text">No faltan fuentes principales.</span>
                  )}
                </div>
              </div>

              <div className="qa-substack">
                <strong>Evidencias reconciliadas</strong>
                {item.evidences.length > 0 ? (
                  item.evidences.map((evidence) => (
                    <div key={evidence.id} className="qa-inline-card">
                      <div className="qa-inline-card__header">
                        <div>
                          <h3>{evidence.sourceLabel}</h3>
                          <p>
                            {evidence.sourceRecordKey}
                            {evidence.rawLabel ? ` · ${evidence.rawLabel}` : ""}
                          </p>
                        </div>
                        <div className="pill-row">
                          {evidence.isPrimary ? <span className="metric-pill">Primary</span> : null}
                          <StatusBadge label={evidence.matchStatus} />
                        </div>
                      </div>
                      <div className="pill-row qa-pill-wrap">
                        <span className="metric-pill">Regla {formatLabel(evidence.matchRule)}</span>
                        <span className="metric-pill">Confianza {formatLabel(evidence.matchConfidence)}</span>
                        <span className="metric-pill">Seen {formatTimestamp(evidence.lastSeenAt)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted-text">No hay registros explícitos en `project_item_evidences` para este item.</p>
                )}
              </div>
            </div>
          </section>

          <section className="qa-why-block">
            <span className="eyebrow">5. Decisión Final</span>
            <p>{item.why.decision.summary}</p>
            {item.why.decision.blockers.length > 0 ? (
              <ul className="qa-bullet-list">
                {item.why.decision.blockers.map((blocker) => (
                  <li key={blocker}>{formatLabel(blocker)}</li>
                ))}
              </ul>
            ) : null}

            <div className="pill-row qa-pill-wrap">
              <StatusBadge label={item.status} />
              <span className="metric-pill">Readiness {item.readinessScore}</span>
              <span className="metric-pill">{formatLabel(item.identificationStatus)}</span>
              <span className="metric-pill">{formatLabel(item.matchingStatus)}</span>
            </div>

            <div className="qa-substack">
              <strong>Alertas activas</strong>
              {renderAlertList(item.alerts)}
            </div>
          </section>
        </div>

        <section className="qa-why-block qa-why-block--full">
          <span className="eyebrow">4. Dimensiones Evaluadas</span>
          <div className="qa-substack">
            {item.dimensions.map((dimension) => renderDimensionCard(dimension))}
          </div>
        </section>
      </div>
    </details>
  );
}

export function FunctionalValidationReport({ report }: { report: FunctionalValidationDiagnosticsReport }) {
  const averageHealth =
    report.scenarios.length === 0
      ? 0
      : Math.round(
          report.scenarios.reduce((total, scenario) => total + scenario.project.healthScore, 0) / report.scenarios.length
        );

  return (
    <div className="stack-lg">
      <section className="page-intro">
        <span className="eyebrow">QA Interno</span>
        <h1>Functional Validation</h1>
        <p>
          Vista diagnóstica de escenarios funcionales. Expone matching, evidencias, dimensiones, alertas y scoring sin
          tocar la UI principal de negocio.
        </p>
      </section>

      <SectionCard
        title="Resumen de validación"
        description={`Evaluado contra ${report.totalScenarios} escenarios semi-reales el ${formatTimestamp(report.generatedAt)}.`}
        action={
          <Link href="/api/internal/functional-validation" className="text-link">
            Ver JSON interno
          </Link>
        }
      >
        <div className="qa-overview-grid">
          <div className="stat-card">
            <div className="stat-card__label">Escenarios</div>
            <div className="stat-card__value">{report.totalScenarios}</div>
            <div className="stat-card__hint">Cobertura funcional cargada</div>
          </div>
          <div className="stat-card stat-card--success">
            <div className="stat-card__label">Expected behavior</div>
            <div className="stat-card__value">{report.passedScenarios}</div>
            <div className="stat-card__hint">Escenarios dentro de expectativa</div>
          </div>
          <div className="stat-card stat-card--danger">
            <div className="stat-card__label">Fallidos</div>
            <div className="stat-card__value">{report.failedScenarios}</div>
            <div className="stat-card__hint">Desvíos a revisar</div>
          </div>
          <div className="stat-card stat-card--warning">
            <div className="stat-card__label">Health promedio</div>
            <div className="stat-card__value">{averageHealth}</div>
            <div className="stat-card__hint">Promedio de casos simulados</div>
          </div>
        </div>
      </SectionCard>

      {report.scenarios.map((scenario) => (
        <SectionCard
          key={scenario.id}
          title={scenario.title}
          description={scenario.summary}
          action={<StatusBadge label={scenario.passed ? "EXPECTED_BEHAVIOR" : "UNEXPECTED_BEHAVIOR"} />}
        >
          <div className="qa-substack">
            <div className="list-row">
              <div className="stack-lg qa-tight-stack">
                <div>
                  <div className="list-row__title">
                    {scenario.project.code} · {scenario.project.name}
                  </div>
                  <div className="list-row__subtitle">
                    {formatLabel(scenario.project.caseType)} · scope {formatLabel(scenario.project.scopeDefined)}
                  </div>
                </div>
                <p>{scenario.project.healthSummary}</p>
              </div>

              <div className="pill-row qa-pill-wrap">
                <StatusBadge label={`Health ${scenario.project.healthScore}`} />
                <span className="metric-pill">Items {scenario.project.itemCount}</span>
                <span className="metric-pill">Esperados {scenario.project.expectedItemCount}</span>
                <span className="metric-pill">Evidenciados {scenario.project.evidencedItemCount}</span>
                <span className="metric-pill">Bloqueados {scenario.project.blockedItemCount}</span>
                <span className="metric-pill">{scenario.project.canClose ? "Can close" : "Cannot close"}</span>
              </div>
            </div>

            {scenario.details.length > 0 ? (
              <div className="qa-inline-card qa-inline-card--danger">
                <strong>Desvíos detectados</strong>
                <ul className="qa-bullet-list">
                  {scenario.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="qa-inline-card">
                <strong>Validación</strong>
                <p>El escenario quedó dentro de los rangos y alertas esperadas.</p>
              </div>
            )}

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project Item</th>
                    <th>Origin</th>
                    <th>Slot</th>
                    <th>Expected</th>
                    <th>Identification</th>
                    <th>Matching</th>
                    <th>Readiness</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <div className="table-subtitle">{item.itemKey}</div>
                      </td>
                      <td>{formatLabel(item.originMode)}</td>
                      <td>{formatLabel(item.componentSlot)}</td>
                      <td>{formatLabel(item.expectedStatus)}</td>
                      <td>{formatLabel(item.identificationStatus)}</td>
                      <td>{formatLabel(item.matchingStatus)}</td>
                      <td>{item.readinessScore}</td>
                      <td>
                        <StatusBadge label={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="qa-substack">
              {scenario.items.map((item) => (
                <ItemWhyPanel key={item.id} item={item} />
              ))}
            </div>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
