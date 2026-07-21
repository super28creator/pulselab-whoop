"use client";

import { useMemo, useState } from "react";
import { SPORTS, searchSports, sportById, type Sport } from "../lib/sports";
import {
  addActivity,
  loadActivities,
  loadFavoriteSports,
  removeActivity,
  toggleFavoriteSport,
  type Activity,
} from "../lib/store";
import { localDateKey } from "../lib/metrics/types";

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

type Props = {
  selectedDate: string;
  onChange: () => void;
};

export function ActivitiesView({ selectedDate, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>(() => loadFavoriteSports());
  const [picker, setPicker] = useState<Sport | null>(null);
  const [tick, setTick] = useState(0);

  const activities = useMemo(
    () => loadActivities(selectedDate),
    [selectedDate, tick],
  );

  const results = useMemo(() => {
    const base = searchSports(query);
    // Favorites first, keeping search relevance
    return [...base].sort((a, b) => {
      const fa = favs.includes(a.id) ? 0 : 1;
      const fb = favs.includes(b.id) ? 0 : 1;
      return fa - fb;
    });
  }, [query, favs]);

  const star = (id: string) => setFavs(toggleFavoriteSport(id));

  const refresh = () => {
    setTick((t) => t + 1);
    onChange();
  };

  return (
    <div className="activities">
      <div className="act-search">
        <span className="act-search-icon">🔍</span>
        <input
          placeholder="Szukaj sportu…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="act-clear" onClick={() => setQuery("")}>
            ✕
          </button>
        )}
      </div>

      {!query && favs.length > 0 && (
        <div className="act-fav-row">
          {favs.map((id) => {
            const s = sportById(id);
            return (
              <button key={id} type="button" className="act-chip" onClick={() => setPicker(s)}>
                <span className="act-emoji">{s.emoji}</span>
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="act-section-title">
        {query ? `Wyniki (${results.length})` : "Wszystkie sporty"}
      </div>

      <div className="act-grid">
        {results.map((s) => (
          <div key={s.id} className={`act-item ${favs.includes(s.id) ? "fav" : ""}`}>
            <button type="button" className="act-item-main" onClick={() => setPicker(s)}>
              <span className="act-emoji lg">{s.emoji}</span>
              <span className="act-name">{s.name}</span>
            </button>
            <button
              type="button"
              className="act-star"
              onClick={() => star(s.id)}
              aria-label="Ulubiony"
            >
              {favs.includes(s.id) ? "★" : "☆"}
            </button>
          </div>
        ))}
      </div>

      <div className="act-section-title">
        Zapisane — {selectedDate === localDateKey() ? "dziś" : selectedDate}
      </div>
      {activities.length === 0 ? (
        <p className="act-empty">Brak aktywności. Wybierz sport powyżej, aby dodać.</p>
      ) : (
        <ul className="act-log">
          {activities.map((a: Activity) => {
            const s = sportById(a.sport);
            const mins = Math.round((a.end - a.start) / 60000);
            return (
              <li key={a.id}>
                <span className="act-emoji">{s.emoji}</span>
                <span className="act-log-name">{s.name}</span>
                <span className="act-log-time">
                  {hhmm(a.start)}–{hhmm(a.end)} · {mins} min
                </span>
                <button
                  type="button"
                  className="act-del"
                  onClick={() => {
                    removeActivity(selectedDate, a.id);
                    refresh();
                  }}
                  aria-label="Usuń"
                >
                  🗑
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picker && (
        <ActivityForm
          sport={picker}
          selectedDate={selectedDate}
          onClose={() => setPicker(null)}
          onSaved={() => {
            setPicker(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ActivityForm({
  sport,
  selectedDate,
  onClose,
  onSaved,
}: {
  sport: Sport;
  selectedDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const now = new Date();
  const [startTime, setStartTime] = useState(
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
  );
  const [duration, setDuration] = useState(60);
  const [note, setNote] = useState("");

  const save = () => {
    const [h, m] = startTime.split(":").map((x) => Number(x));
    const [Y, Mo, D] = selectedDate.split("-").map((x) => Number(x));
    const start = new Date(Y, Mo - 1, D, h || 0, m || 0, 0, 0).getTime();
    const end = start + Math.max(1, duration) * 60_000;
    addActivity({ sport: sport.id, start, end, manual: true, note: note || undefined });
    onSaved();
  };

  return (
    <div className="modal" role="dialog" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>
          {sport.emoji} {sport.name}
        </h2>
        <label>
          Godzina startu
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label>
          Czas trwania (min)
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 1)}
          />
        </label>
        <div className="quick-durations">
          {[30, 45, 60, 90, 120].map((d) => (
            <button
              key={d}
              type="button"
              className={`chip ${duration === d ? "on" : ""}`}
              onClick={() => setDuration(d)}
            >
              {d}m
            </button>
          ))}
        </div>
        <label>
          Notatka (opcjonalnie)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. interwały" />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Anuluj
          </button>
          <button type="button" className="primary" onClick={save}>
            Dodaj
          </button>
        </div>
      </div>
    </div>
  );
}

export { SPORTS };
