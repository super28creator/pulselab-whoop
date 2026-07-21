"use client";

import { useMemo, type ReactNode } from "react";

type RingProps = {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  color: string;
  track?: string;
  children?: ReactNode;
};

export function ScoreRing({
  value,
  max,
  size = 160,
  stroke = 10,
  color,
  track = "rgba(255,255,255,0.08)",
  children,
}: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value / max));
  const dash = c * pct;

  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="ring-svg">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ring-progress"
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function recoveryColor(band: "red" | "yellow" | "green"): string {
  if (band === "green") return "#16ec92";
  if (band === "yellow") return "#f5c518";
  return "#ff3b5c";
}

export function useSparkPath(values: number[], w = 120, h = 36): string {
  return useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values) - 1;
    const max = Math.max(...values) + 1;
    const span = Math.max(max - min, 1);
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * w;
        const y = h - ((v - min) / span) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values, w, h]);
}
