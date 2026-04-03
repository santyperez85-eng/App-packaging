import { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "default" | "success" | "warning" | "danger";
  children?: ReactNode;
};

export function StatCard({ label, value, hint, accent = "default", children }: StatCardProps) {
  return (
    <article className={`stat-card stat-card--${accent}`}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      {hint ? <div className="stat-card__hint">{hint}</div> : null}
      {children}
    </article>
  );
}
