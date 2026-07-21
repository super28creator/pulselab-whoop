"use client";

import { useMemo, useState } from "react";
import { loadSummaries, type DaySummary } from "../lib/store";
import { localDateKey } from "../lib/metrics/types";

function recColor(v: number | null): string {
  if (v == null) return "rgba(255,255,255,0.06)";
  if (v >= 67) return "#16ec92";
  if (v >= 34) return "#f5c518";
  return "#ff3b5c";
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
}

type Props = {
  selected: string;
  onSelect: (dateKey: string) => void;
};

export function CalendarView({ selected, onSelect }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [detailed, setDetailed] = useState(false);

  const summaries = useMemo(() => loadSummaries(), []);
  const todayKey = localDateKey();

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    // Monday-first offset
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: Array<{ key: string; day: number; sum: DaySummary | null } | null> = [];
    for (let i = 0; i < startOffset; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = localDateKey(new Date(year, month, d).getTime());
      out.push({ key, day: d, sum: summaries[key] ?? null });
    }
    return out;
  }, [year, month, summaries]);

  const prev = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
  };
  const next = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
  };

  return (
    <div className="calendar">
      <div className="cal-head">
        <button type="button" className="icon-btn sm" onClick={prev} aria-label="Poprzedni">
          ‹
        </button>
        <span className="cal-month">{monthLabel(year, month)}</span>
        <button type="button" className="icon-btn sm" onClick={next} aria-label="Nastepny">
          ›
        </button>
        <button
          type="button"
          className={`icon-btn sm ${detailed ? "active" : ""}`}
          onClick={() => setDetailed((v) => !v)}
          aria-label="Szczegoly"
          title="Pokaż 3 kluczowe staty"
        >
          📅
        </button>
      </div>

      <div className="cal-dow">
        {["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className={`cal-grid ${detailed ? "detailed" : ""}`}>
        {cells.map((c, i) =>
          c == null ? (
            <div key={`e${i}`} className="cal-cell empty" />
          ) : (
            <button
              key={c.key}
              type="button"
              className={`cal-cell ${c.key === selected ? "selected" : ""} ${c.key === todayKey ? "today" : ""}`}
              onClick={() => onSelect(c.key)}
            >
              <span className="cal-day">{c.day}</span>
              <span className="cal-dot" style={{ background: recColor(c.sum?.recovery ?? null) }} />
              {detailed && c.sum && (
                <span className="cal-stats">
                  <span style={{ color: recColor(c.sum.recovery) }}>
                    {c.sum.recovery != null ? `${c.sum.recovery}%` : "—"}
                  </span>
                  <span style={{ color: "#00f0ff" }}>{c.sum.strain.toFixed(1)}</span>
                  <span style={{ color: "#5b8cff" }}>
                    {c.sum.sleep != null ? `${c.sum.sleep}%` : "—"}
                  </span>
                </span>
              )}
            </button>
          ),
        )}
      </div>

      <div className="cal-legend">
        <span><i className="lg" style={{ background: "#16ec92" }} /> Recovery</span>
        <span><i className="lg" style={{ background: "#00f0ff" }} /> Strain</span>
        <span><i className="lg" style={{ background: "#5b8cff" }} /> Sleep</span>
      </div>
    </div>
  );
}
