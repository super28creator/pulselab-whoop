"use client";

type Props = {
  title?: string;
  subtitle?: string;
  records?: number;
  chunks?: number;
  /** 0–100 indeterminate when omitted */
  progress?: number | null;
  mode?: "boot" | "sync";
};

export function LoadingScreen({
  title = "PULSELAB",
  subtitle = "Ładuję…",
  records = 0,
  chunks = 0,
  progress = null,
  mode = "boot",
}: Props) {
  const pct = progress != null ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <div className={`load-screen load-${mode}`} role="status" aria-live="polite">
      <div className="load-glow" aria-hidden />
      <div className="load-orb" aria-hidden>
        <span className="load-ring" />
        <span className="load-ring delay" />
        <span className="load-core" />
      </div>
      <p className="load-brand">{title}</p>
      <p className="load-sub">{subtitle}</p>
      <div className="load-bar" aria-hidden>
        <div
          className={`load-bar-fill ${pct == null ? "indeterminate" : ""}`}
          style={pct != null ? { width: `${pct}%` } : undefined}
        />
      </div>
      {(records > 0 || chunks > 0) && (
        <p className="load-meta">
          {records > 0 ? `${records.toLocaleString("pl-PL")} punktów` : null}
          {records > 0 && chunks > 0 ? " · " : null}
          {chunks > 0 ? `${chunks} paczek` : null}
        </p>
      )}
    </div>
  );
}
