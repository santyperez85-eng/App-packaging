type StatusBadgeProps = {
  label: string;
};

function toneForStatus(label: string) {
  const normalized = label.toLowerCase();

  if (normalized.includes("critical") || normalized.includes("blocked") || normalized.includes("cr") || normalized === "open") {
    return "danger";
  }

  if (normalized.includes("warning") || normalized.includes("waiting") || normalized.includes("in_progress")) {
    return "warning";
  }

  if (normalized.includes("ready") || normalized.includes("approved") || normalized.includes("resolved") || normalized.includes("closed")) {
    return "success";
  }

  return "neutral";
}

export function StatusBadge({ label }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${toneForStatus(label)}`}>{label}</span>;
}
