import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";

function formatDate(value?: Date | string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(value));
}

type ExecutivePanelProps = {
  snapshot: {
    totals: {
      totalProjects: number;
      activeProjects: number;
      blockedProjects: number;
      totalItems: number;
      readyItems: number;
      openAlerts: number;
      criticalAlerts: number;
    };
    atRiskProjects: Array<{
      id: string;
      code: string;
      name: string;
      healthScore: number;
      status: string;
      targetLaunchDate?: Date | null;
    }>;
    recentAlerts: Array<{
      id: string;
      title: string;
      severity: string;
      project?: { code: string } | null;
      projectItem?: { name: string } | null;
      createdAt: Date;
    }>;
  };
};

export function ExecutivePanel({ snapshot }: ExecutivePanelProps) {
  return (
    <div className="stack-lg">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">Dashboard Operativo</span>
          <h1>Packaging control para proyectos regulados</h1>
          <p>
            Consolida proyectos, materiales, BOM, pedidos de código y workflow de diseño en una sola
            capa operativa.
          </p>
        </div>

        <div className="hero-panel__meta">
          <div>
            <strong>{snapshot.totals.openAlerts}</strong>
            <span>alertas abiertas</span>
          </div>
          <div>
            <strong>{snapshot.totals.readyItems}</strong>
            <span>items listos</span>
          </div>
        </div>
      </section>

      <div className="stats-grid">
        <StatCard label="Proyectos totales" value={snapshot.totals.totalProjects} hint="Cartera consolidada" />
        <StatCard label="Proyectos activos" value={snapshot.totals.activeProjects} accent="success" />
        <StatCard label="Proyectos bloqueados" value={snapshot.totals.blockedProjects} accent="danger" />
        <StatCard label="Project items" value={snapshot.totals.totalItems} hint="Entidad operativa central" />
        <StatCard label="Items listos" value={snapshot.totals.readyItems} accent="success" />
        <StatCard label="Alertas críticas" value={snapshot.totals.criticalAlerts} accent="danger" />
      </div>

      <div className="grid-two">
        <section className="section-card">
          <header className="section-card__header">
            <div>
              <h2>Proyectos en riesgo</h2>
              <p>Health score bajo o alertas críticas abiertas</p>
            </div>
            <Link href="/projects" className="text-link">
              Ver todos
            </Link>
          </header>

          <div className="list-stack">
            {snapshot.atRiskProjects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="list-row">
                <div>
                  <div className="list-row__title">{project.code}</div>
                  <div className="list-row__subtitle">{project.name}</div>
                </div>
                <div className="list-row__meta">
                  <StatusBadge label={project.status} />
                  <span className="metric-pill">Health {project.healthScore}</span>
                  <span className="muted-text">{formatDate(project.targetLaunchDate)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="section-card">
          <header className="section-card__header">
            <div>
              <h2>Alertas recientes</h2>
              <p>Riesgos o inconsistencias detectadas por reglas base</p>
            </div>
            <Link href="/alerts" className="text-link">
              Ver alertas
            </Link>
          </header>

          <div className="list-stack">
            {snapshot.recentAlerts.map((alert) => (
              <div key={alert.id} className="list-row">
                <div>
                  <div className="list-row__title">{alert.title}</div>
                  <div className="list-row__subtitle">
                    {alert.project?.code ?? "Sin proyecto"} · {alert.projectItem?.name ?? "Sin item"}
                  </div>
                </div>
                <div className="list-row__meta">
                  <StatusBadge label={alert.severity} />
                  <span className="muted-text">{formatDate(alert.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
