"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
const PAD = { l: 40, r: 8, t: 8, b: 22 };

function buildPath(
  points: ChartPoint[],
  dayStart: number,
  plotW: number,
  plotH: number,
  yMin: number,
  yMax: number,
): { line: string; area: string } {
  if (points.length < 2) return { line: "", area: "" };
  const span = Math.max(yMax - yMin, 1);
  const xy = points.map((p) => {
    const x = PAD.l + ((p.t - dayStart) / DAY_MS) * plotW;
    const y = PAD.t + (plotH - ((p.v - yMin) / span) * plotH);
    return [Math.max(PAD.l, Math.min(PAD.l + plotW, x)), Math.max(PAD.t, Math.min(PAD.t + plotH, y))] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const baseY = PAD.t + plotH;
  const area = `${line} L${xy[xy.length - 1]![0].toFixed(1)},${baseY} L${xy[0]![0].toFixed(1)},${baseY} Z`;
  return { line, area };
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = Math.max(max - min, 1);
  // Prefer round steps for wide HR scales (0–300)
  if (span >= 100) {
    const step = span / (count - 1);
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(Math.round(min + step * i));
    return out;
  }
  const step = span / (count - 1);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((min + step * i) * 10) / 10);
  return out;
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
  showScale,
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
  showScale?: boolean;
  id: string;
}) {
  const plotW = w - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;
  const { line, area } = useMemo(
    () => buildPath(points, dayStart, plotW, plotH, yMin, yMax),
    [points, dayStart, plotW, plotH, yMin, yMax],
  );
  const gid = `grad-${id}`;
  const yTicks = niceTicks(yMin, yMax, showScale ? 5 : 3);
  const span = Math.max(yMax - yMin, 1);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="daychart-svg" width="100%" height={h} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Y grid + scale */}
      {yTicks.map((v) => {
        const y = PAD.t + (plotH - ((v - yMin) / span) * plotH);
        return (
          <g key={`y${v}`}>
            <line x1={PAD.l} y1={y} x2={PAD.l + plotW} y2={y} stroke="rgba(255,255,255,0.06)" />
            {showScale && (
              <text x={PAD.l - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#8a8a92">
                {Number.isInteger(v) ? v : v.toFixed(1)}
              </text>
            )}
          </g>
        );
      })}

      {activities?.map((a) => {
        const x1 = PAD.l + ((a.start - dayStart) / DAY_MS) * plotW;
        const x2 = PAD.l + ((Math.min(a.end, dayStart + DAY_MS) - dayStart) / DAY_MS) * plotW;
        const bw = Math.max(2, x2 - x1);
        return (
          <g key={a.id}>
            <rect x={Math.max(PAD.l, x1)} y={PAD.t} width={bw} height={plotH} fill="rgba(255,255,255,0.07)" />
            <rect x={Math.max(PAD.l, x1)} y={PAD.t} width={2} height={plotH} fill={color} opacity="0.5" />
            {showScale && (
              <text x={Math.max(PAD.l, x1) + 4} y={PAD.t + 12} fontSize="10" fill="#9aa">
                {sportById(a.sport).emoji}
              </text>
            )}
          </g>
        );
      })}

      {area && <path d={area} fill={`url(#${gid})`} />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}

      {[0, 6, 12, 18, 24].map((hr) => {
        const x = PAD.l + (hr / 24) * plotW;
        return (
          <g key={hr}>
            <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + plotH} stroke="rgba(255,255,255,0.05)" />
            <text x={Math.min(w - 20, Math.max(PAD.l, x))} y={h - 4} fontSize="9" fill="#8a8a92">
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
  const fullRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(340);
  const lo = yMin ?? (points.length ? Math.floor(Math.min(...points.map((p) => p.v)) - 1) : 0);
  const hi = yMax ?? (points.length ? Math.ceil(Math.max(...points.map((p) => p.v)) + 1) : 10);
  const empty = points.length < 2;

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      if (fullRef.current) setWide(Math.max(280, fullRef.current.clientWidth));
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
              h={96}
              yMin={lo}
              yMax={hi}
              activities={activities}
              showScale
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
            <p className="chart-hint">Cały dzień · skala {lo}–{hi}</p>
            <div className="chart-full" ref={fullRef}>
              <ChartSvg
                id={`big-${title}`}
                points={points}
                color={color}
                dayStart={dayStart}
                w={wide}
                h={260}
                yMin={lo}
                yMax={hi}
                activities={activities}
                showScale
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
