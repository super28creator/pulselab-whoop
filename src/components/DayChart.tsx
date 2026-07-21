"use client";

import { useEffect, useMemo, useState } from "react";
import { sportById } from "../lib/sports";
import type { Activity } from "../lib/store";

export type ChartPoint = { t: number; v: number };

type Props = {
  title: string;
  unit?: string;
  color: string;
  points: ChartPoint[];
  dayStart: number;
  yMin?: number;
  yMax?: number;
  activities?: Activity[];
  headline?: string;
};

const DAY_MS = 24 * 60 * 60_000;

function buildPath(
  points: ChartPoint[],
  dayStart: number,
  w: number,
  h: number,
  yMin: number,
  yMax: number,
): { line: string; area: string } {
  if (points.length < 2) return { line: "", area: "" };
  const span = Math.max(yMax - yMin, 1);
  const xy = points.map((p) => {
    const x = ((p.t - dayStart) / DAY_MS) * w;
    const y = h - ((p.v - yMin) / span) * h;
    return [Math.max(0, Math.min(w, x)), Math.max(0, Math.min(h, y))] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1]![0].toFixed(1)},${h} L${xy[0]![0].toFixed(1)},${h} Z`;
  return { line, area };
}

function ChartSvg({
  points,
  color,
  dayStart,
  w,
  h,
  yMin,
  yMax,
  activities,
  showHours,
  id,
}: {
  points: ChartPoint[];
  color: string;
  dayStart: number;
  w: number;
  h: number;
  yMin: number;
  yMax: number;
  activities?: Activity[];
  showHours?: boolean;
  id: string;
}) {
  const { line, area } = useMemo(
    () => buildPath(points, dayStart, w, h, yMin, yMax),
    [points, dayStart, w, h, yMin, yMax],
  );
  const gid = `grad-${id}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h + (showHours ? 18 : 0)}`}
      preserveAspectRatio="none"
      className="daychart-svg"
      width="100%"
      height={h + (showHours ? 18 : 0)}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {activities?.map((a) => {
        const x1 = ((a.start - dayStart) / DAY_MS) * w;
        const x2 = ((Math.min(a.end, dayStart + DAY_MS) - dayStart) / DAY_MS) * w;
        const bw = Math.max(2, x2 - x1);
        return (
          <g key={a.id}>
            <rect x={Math.max(0, x1)} y={0} width={bw} height={h} fill="rgba(255,255,255,0.07)" />
            <rect x={Math.max(0, x1)} y={0} width={2} height={h} fill={color} opacity="0.5" />
            {showHours && (
              <text x={Math.max(0, x1) + 4} y={12} fontSize="10" fill="#9aa">
                {sportById(a.sport).emoji}
              </text>
            )}
          </g>
        );
      })}

      {area && <path d={area} fill={`url(#${gid})`} />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}

      {showHours &&
        [0, 6, 12, 18, 24].map((hr) => {
          const x = (hr / 24) * w;
          return (
            <g key={hr}>
              <line x1={x} y1={0} x2={x} y2={h} stroke="rgba(255,255,255,0.06)" />
              <text x={Math.min(w - 18, Math.max(0, x + 2))} y={h + 14} fontSize="10" fill="#9aa">
                {hr}:00
              </text>
            </g>
          );
        })}
    </svg>
  );
}

export function DayChart({
  title,
  unit,
  color,
  points,
  dayStart,
  yMin,
  yMax,
  activities,
  headline,
}: Props) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(340);
  const lo = yMin ?? (points.length ? Math.min(...points.map((p) => p.v)) - 2 : 0);
  const hi = yMax ?? (points.length ? Math.max(...points.map((p) => p.v)) + 2 : 10);
  const empty = points.length < 2;

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = document.querySelector(".chart-full");
      if (el) setWide(Math.max(280, el.clientWidth));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="daychart-mini"
        onClick={() => !empty && setOpen(true)}
        disabled={empty}
      >
        <div className="daychart-head">
          <span className="daychart-title">{title}</span>
          {headline && (
            <span className="daychart-headline" style={{ color }}>
              {headline}
            </span>
          )}
        </div>
        {empty ? (
          <div className="daychart-empty">Brak danych — noś opaskę / połącz</div>
        ) : (
          <div className="daychart-minibody">
            <ChartSvg
              id={`mini-${title}`}
              points={points}
              color={color}
              dayStart={dayStart}
              w={360}
              h={72}
              yMin={lo}
              yMax={hi}
              activities={activities}
            />
            <span className="daychart-expand">⤢</span>
          </div>
        )}
      </button>

      {open && (
        <div className="modal chart-modal" role="dialog" onClick={() => setOpen(false)}>
          <div className="chart-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="chart-modal-head">
              <div>
                <h2>{title}</h2>
                {unit && <span className="daychart-unit">{unit}</span>}
              </div>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Zamknij">
                ✕
              </button>
            </div>
            <p className="chart-hint">Cały dzień · 0:00–24:00</p>
            <div className="chart-full">
              <ChartSvg
                id={`big-${title}`}
                points={points}
                color={color}
                dayStart={dayStart}
                w={wide}
                h={220}
                yMin={lo}
                yMax={hi}
                activities={activities}
                showHours
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
