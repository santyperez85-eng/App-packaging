"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";

type ReviewQueueData = {
  generatedAt: string;
  pendingBomConfirmations: Array<{
    alertId: string;
    title: string;
    message: string;
    severity: string;
    project: { id: string; code: string; name: string } | null;
    projectItem: { id: string; itemKey: string; name: string; componentSlot: string } | null;
  }>;
  evidenceReviews: Array<{
    evidenceId: string;
    sourceType: string;
    sourceRecordKey: string;
    rawLabel: string | null;
    matchRule: string | null;
    matchConfidence: string;
    matchStatus: string;
    projectItem: {
      id: string;
      itemKey: string;
      name: string;
      componentSlot: string;
      project: { id: string; code: string; name: string };
    };
  }>;
  competingMaterialRequests: Array<{
    projectItem: {
      id: string;
      itemKey: string;
      name: string;
      componentSlot: string;
      project: { id: string; code: string; name: string };
    };
    linkedRequest: { id: string; requestCode: string | null; requestedDescription: string } | null;
    candidates: Array<{
      materialRequestId: string | null;
      requestCode: string | null;
      requestedDescription: string | null;
      evidenceSourceRecordKey: string;
      isCurrentLink: boolean;
    }>;
  }>;
};

async function postAction(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    throw new Error(payload?.error ?? `La acción falló (${response.status})`);
  }
}

function useReviewAction() {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setError(null);

    try {
      await action();
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "La acción falló");
    } finally {
      setBusyKey(null);
    }
  }

  return { busyKey, error, run };
}

export function ReviewQueue({ queue }: { queue: ReviewQueueData }) {
  const { busyKey, error, run } = useReviewAction();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const totalPending =
    queue.pendingBomConfirmations.length + queue.evidenceReviews.length + queue.competingMaterialRequests.length;

  function noteFor(key: string) {
    return notes[key] ?? "";
  }

  function setNoteFor(key: string, value: string) {
    setNotes((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="stack-lg">
      {error ? <div className="review-error">{error}</div> : null}

      {totalPending === 0 ? (
        <SectionCard title="Sin pendientes" description="No hay decisiones manuales esperando revisión.">
          <p className="muted-text">
            Cuando una importación deje casos ambiguos o confirmaciones pendientes, van a aparecer acá.
          </p>
        </SectionCard>
      ) : null}

      {queue.competingMaterialRequests.length ? (
        <SectionCard
          title={`Pedidos de código en competencia (${queue.competingMaterialRequests.length})`}
          description="Más de un pedido de código evidencia el mismo componente. Elegí cuál es el vínculo canónico."
        >
          <div className="list-stack">
            {queue.competingMaterialRequests.map((entry) => (
              <article key={entry.projectItem.id} className="review-card">
                <header className="review-card__header">
                  <div>
                    <div className="list-row__title">
                      <Link className="table-link" href={`/project-items/${entry.projectItem.id}`}>
                        {entry.projectItem.project.code} · {entry.projectItem.itemKey}
                      </Link>
                    </div>
                    <div className="list-row__subtitle">{entry.projectItem.name}</div>
                  </div>
                  <span className="metric-pill">
                    Vínculo actual: {entry.linkedRequest?.requestCode ?? "Sin vínculo"}
                  </span>
                </header>
                <div className="list-stack">
                  {entry.candidates.map((candidate) => {
                    const actionKey = `link:${entry.projectItem.id}:${candidate.materialRequestId ?? candidate.evidenceSourceRecordKey}`;

                    return (
                      <div key={candidate.evidenceSourceRecordKey} className="list-row">
                        <div>
                          <div className="list-row__title">{candidate.requestCode ?? "Sin código"}</div>
                          <div className="list-row__subtitle">{candidate.requestedDescription ?? "Sin descripción"}</div>
                        </div>
                        <div className="list-row__meta">
                          {candidate.isCurrentLink ? <StatusBadge label="ACTUAL" /> : null}
                          <button
                            type="button"
                            className="action-button"
                            disabled={!candidate.materialRequestId || busyKey === actionKey || candidate.isCurrentLink}
                            onClick={() =>
                              run(actionKey, () =>
                                postAction(`/api/project-items/${entry.projectItem.id}/link-material-request`, {
                                  materialRequestId: candidate.materialRequestId,
                                  note: noteFor(`link:${entry.projectItem.id}`) || undefined
                                })
                              )
                            }
                          >
                            {busyKey === actionKey ? "Confirmando…" : "Elegir como canónico"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <input
                  className="review-note"
                  placeholder="Nota de la decisión (opcional)"
                  value={noteFor(`link:${entry.projectItem.id}`)}
                  onChange={(event) => setNoteFor(`link:${entry.projectItem.id}`, event.target.value)}
                />
              </article>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {queue.pendingBomConfirmations.length ? (
        <SectionCard
          title={`Confirmaciones de estructura pre-SAP (${queue.pendingBomConfirmations.length})`}
          description="Hay evidencia BOM pero el bloque conserva confirmaciones operativas pendientes."
        >
          <div className="list-stack">
            {queue.pendingBomConfirmations.map((entry) => {
              const actionKey = `bom:${entry.alertId}`;

              return (
                <article key={entry.alertId} className="review-card">
                  <header className="review-card__header">
                    <div>
                      <div className="list-row__title">
                        {entry.projectItem ? (
                          <Link className="table-link" href={`/project-items/${entry.projectItem.id}`}>
                            {entry.project?.code} · {entry.projectItem.itemKey}
                          </Link>
                        ) : (
                          entry.title
                        )}
                      </div>
                      <div className="list-row__subtitle">{entry.message}</div>
                    </div>
                    <StatusBadge label={entry.severity} />
                  </header>
                  <div className="review-card__actions">
                    <input
                      className="review-note"
                      placeholder="Qué se confirmó (opcional)"
                      value={noteFor(actionKey)}
                      onChange={(event) => setNoteFor(actionKey, event.target.value)}
                    />
                    <button
                      type="button"
                      className="action-button"
                      disabled={busyKey === actionKey}
                      onClick={() =>
                        run(actionKey, () =>
                          postAction(`/api/alerts/${entry.alertId}/resolve`, {
                            note: noteFor(actionKey) || undefined
                          })
                        )
                      }
                    >
                      {busyKey === actionKey ? "Confirmando…" : "Confirmar estructura"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </SectionCard>
      ) : null}

      {queue.evidenceReviews.length ? (
        <SectionCard
          title={`Evidencias en revisión (${queue.evidenceReviews.length})`}
          description="Matches ambiguos o marcados para revisión manual."
        >
          <div className="list-stack">
            {queue.evidenceReviews.map((entry) => {
              const actionKey = `evidence:${entry.evidenceId}`;

              return (
                <article key={entry.evidenceId} className="review-card">
                  <header className="review-card__header">
                    <div>
                      <div className="list-row__title">{entry.rawLabel ?? entry.sourceRecordKey}</div>
                      <div className="list-row__subtitle">
                        {entry.sourceType} ·{" "}
                        <Link className="table-link" href={`/project-items/${entry.projectItem.id}`}>
                          {entry.projectItem.project.code} · {entry.projectItem.itemKey}
                        </Link>
                      </div>
                    </div>
                    <div className="list-row__meta">
                      <StatusBadge label={entry.matchStatus} />
                      <span className="metric-pill">{entry.matchRule ?? "Sin regla"}</span>
                    </div>
                  </header>
                  <div className="review-card__actions">
                    <input
                      className="review-note"
                      placeholder="Nota de la decisión (opcional)"
                      value={noteFor(actionKey)}
                      onChange={(event) => setNoteFor(actionKey, event.target.value)}
                    />
                    <button
                      type="button"
                      className="action-button"
                      disabled={busyKey === actionKey}
                      onClick={() =>
                        run(actionKey, () =>
                          postAction(`/api/evidences/${entry.evidenceId}/confirm`, {
                            note: noteFor(actionKey) || undefined
                          })
                        )
                      }
                    >
                      {busyKey === actionKey ? "Confirmando…" : "Confirmar match"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
