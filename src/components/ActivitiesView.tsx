"use client";

import { useEffect, useMemo, useState } from "react";
import { searchSports, sportById, type Sport } from "../lib/sports";
import {
  addActivity,
  loadActiveSession,
  loadActivities,
  loadFavoriteSports,
  removeActivity,
  startActiveSession,
  stopActiveSession,
  toggleFavoriteSport,
  updateActivity,
  type ActiveSession,
  type Activity,
} from "../lib/store";
import { localDateKey } from "../lib/metrics/types";

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

function elapsed(start: number, now: number): string {
  const s = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

type Props = {
  selectedDate: string;
  onChange: () => void;
};

export function ActivitiesView({ selectedDate, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>(() => loadFavoriteSports());
  const [active, setActive] = useState<ActiveSession | null>(() => loadActiveSession());
  const [now, setNow] = useState(Date.now());
  const [edit, setEdit] = useState<Activity | null>(null);
  const [manualSport, setManualSport] = useState<Sport | null>(null);
  const [tick, setTick] = useState(0);
  const isToday = selectedDate === localDateKey();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const activities = useMemo(() => loadActivities(selectedDate), [selectedDate, tick]);

  const results = useMemo(() => {
    const base = searchSports(query);
    return [...base].sort((a, b) => {
      const fa = favs.includes(a.id) ? 0 : 1;
      const fb = favs.includes(b.id) ? 0 : 1;
      return fa - fb;
    });
  }, [query, favs]);

  const star = (id: string) => setFavs(toggleFavoriteSport(id));

  const refresh = () => {
    setTick((t) => t + 1);
    setActive(loadActiveSession());
    onChange();
  };

  const startSport = (sport: Sport) => {
    if (!isToday) {
      setManualSport(sport);
      return;
    }
    if (active) {
      // already running — ignore or ask? just return
      return;
    }
    startActiveSession(sport.id);
    setActive(loadActiveSession());
    onChange();
  };

  const stop = () => {
    stopActiveSession();
    setActive(null);
    refresh();
  };

  return (
    <div className="activities">
      {active && isToday && (
        <div className="act-live">
          <div>
            <p className="act-live-label">Trwa trening</p>
            <p className="act-live-name">
              {sportById(active.sport).emoji} {sportById(active.sport).name}
            </p>
            <p className="act-live-timer">{elapsed(active.start, now)}</p>
          </div>
          <button type="button" className="primary stop-btn" onClick={stop}>
            Zakończ
          </button>
        </div>
      )}

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
              <button
                key={id}
                type="button"
                className="act-chip"
                onClick={() => startSport(s)}
                disabled={!!active && isToday}
              >
                <span className="act-emoji">{s.emoji}</span>
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="act-section-title">
        {active && isToday
          ? "Trening w toku — zakończ, żeby zacząć inny"
          : query
            ? `Wyniki (${results.length})`
            : isToday
              ? "Wybierz sport — Start"
              : "Dodaj ręcznie (edycja przeszłości)"}
      </div>

      <div className="act-grid">
        {results.map((s) => (
          <div key={s.id} className={`act-item ${favs.includes(s.id) ? "fav" : ""}`}>
            <button
              type="button"
              className="act-item-main"
              onClick={() => startSport(s)}
              disabled={!!active && isToday}
            >
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
        Historia — {isToday ? "dziś" : selectedDate}
      </div>
      {activities.length === 0 ? (
        <p className="act-empty">
          {isToday
            ? "Wybierz sport i naciśnij — zapisze się dopiero po zakończeniu."
            : "Brak aktywności w tym dniu."}
        </p>
      ) : (
        <ul className="act-log">
          {activities.map((a: Activity) => {
            const s = sportById(a.sport);
            const mins = Math.max(1, Math.round((a.end - a.start) / 60000));
            return (
              <li key={a.id}>
                <span className="act-emoji">{s.emoji}</span>
                <button type="button" className="act-log-main" onClick={() => setEdit(a)}>
                  <span className="act-log-name">{s.name}</span>
                  <span className="act-log-time">
                    {hhmm(a.start)}–{hhmm(a.end)} · {mins} min
                  </span>
                </button>
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

      {edit && (
        <EditActivityForm
          activity={edit}
          dateKey={selectedDate}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            refresh();
          }}
        />
      )}

      {manualSport && (
        <ManualPastForm
          sport={manualSport}
          selectedDate={selectedDate}
          onClose={() => setManualSport(null)}
          onSaved={() => {
            setManualSport(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function EditActivityForm({
  activity,
  dateKey,
  onClose,
  onSaved,
}: {
  activity: Activity;
  dateKey: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = sportById(activity.sport);
  const toTime = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const [startTime, setStartTime] = useState(toTime(activity.start));
  const [endTime, setEndTime] = useState(toTime(activity.end));

  const save = () => {
    const [Y, Mo, D] = dateKey.split("-").map(Number);
    const parse = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return new Date(Y, Mo - 1, D, h || 0, m || 0, 0, 0).getTime();
    };
    let start = parse(startTime);
    let end = parse(endTime);
    if (end <= start) end = start + 60_000;
    updateActivity(dateKey, activity.id, { start, end, manual: true });
    onSaved();
  };

  return (
    <div className="modal" role="dialog" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>
          {s.emoji} Edytuj — {s.name}
        </h2>
        <label>
          Start
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label>
          Koniec
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Anuluj
          </button>
          <button type="button" className="primary" onClick={save}>
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}

/** For past days only — start/end times. */
function ManualPastForm({
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
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");

  const save = () => {
    const [Y, Mo, D] = selectedDate.split("-").map(Number);
    const parse = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return new Date(Y, Mo - 1, D, h || 0, m || 0, 0, 0).getTime();
    };
    let start = parse(startTime);
    let end = parse(endTime);
    if (end <= start) end = start + 60_000;
    addActivity({ sport: sport.id, start, end, manual: true });
    onSaved();
  };

  return (
    <div className="modal" role="dialog" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>
          {sport.emoji} {sport.name}
        </h2>
        <p className="provisional" style={{ textAlign: "left", maxWidth: "none", margin: "0 0 0.75rem" }}>
          Dodajesz aktywność do przeszłego dnia — podaj godziny.
        </p>
        <label>
          Start
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label>
          Koniec
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
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
