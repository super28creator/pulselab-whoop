/** Cloud pull/push for Whoop history — fast boot from Supabase. */

import { getSupabase, isSupabaseConfigured } from "./supabase";
import {
  appendSample,
  beginBulkWrite,
  endBulkWrite,
  loadDaySamples,
  loadSyncCursor,
  saveSyncCursor,
  type DaySummary,
  saveDaySummary,
} from "./store";
import { localDateKey, type HrSample } from "./metrics/types";

export type CloudBootResult = {
  ok: boolean;
  samples: number;
  error?: string;
};

async function ensureUserId(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData.session?.user?.id) return sessionData.session.user.id;

  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return data.user?.id ?? null;
}

export async function pullCloudHistory(days = 8): Promise<CloudBootResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, samples: 0, error: "Brak konfiguracji Supabase" };
  }
  try {
    const sb = getSupabase()!;
    const userId = await ensureUserId();
    if (!userId) return { ok: false, samples: 0, error: "Brak sesji" };

    // Meta cursor
    const { data: meta } = await sb
      .from("pulselab_meta")
      .select("sync_cursor")
      .eq("user_id", userId)
      .maybeSingle();
    if (meta?.sync_cursor) saveSyncCursor(Number(meta.sync_cursor));

    const since = Date.now() - days * 24 * 60 * 60_000;
    const { data, error } = await sb
      .from("hr_samples")
      .select("t,bpm,rr_ms,date_key")
      .eq("user_id", userId)
      .gte("t", since)
      .order("t", { ascending: true })
      .limit(50_000);

    if (error) throw error;
    if (!data?.length) return { ok: true, samples: 0 };

    beginBulkWrite();
    let n = 0;
    try {
      for (const row of data) {
        const sample: HrSample = {
          t: Number(row.t),
          bpm: Number(row.bpm),
          rrMs: row.rr_ms?.length ? row.rr_ms : undefined,
        };
        appendSample(sample, { history: true });
        n++;
      }
    } finally {
      endBulkWrite();
    }

    // Day summaries (calendar)
    const { data: sums } = await sb
      .from("day_summaries")
      .select("date_key,payload")
      .eq("user_id", userId)
      .order("date_key", { ascending: false })
      .limit(40);
    if (sums?.length) {
      for (const s of sums) {
        if (s.payload && typeof s.payload === "object") {
          saveDaySummary(s.payload as DaySummary);
        }
      }
    }

    return { ok: true, samples: n };
  } catch (e) {
    return {
      ok: false,
      samples: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function pushLocalHistoryToCloud(): Promise<{ pushed: number; error?: string }> {
  if (!isSupabaseConfigured()) return { pushed: 0, error: "Brak Supabase" };
  try {
    const sb = getSupabase()!;
    const userId = await ensureUserId();
    if (!userId) return { pushed: 0, error: "Brak sesji" };

    const rows: Array<{
      user_id: string;
      t: number;
      bpm: number;
      date_key: string;
      rr_ms: number[] | null;
    }> = [];

    for (let i = 0; i < 8; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDateKey(d.getTime());
      for (const s of loadDaySamples(key)) {
        rows.push({
          user_id: userId,
          t: s.t,
          bpm: s.bpm,
          date_key: key,
          rr_ms: s.rrMs?.length ? s.rrMs.slice(0, 8) : null,
        });
      }
    }

    let pushed = 0;
    const chunk = 400;
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);
      const { error } = await sb.from("hr_samples").upsert(part, { onConflict: "user_id,t" });
      if (error) throw error;
      pushed += part.length;
    }

    const cursor = loadSyncCursor();
    if (cursor > 0) {
      await sb.from("pulselab_meta").upsert({
        user_id: userId,
        sync_cursor: cursor,
        updated_at: new Date().toISOString(),
      });
    }

    return { pushed };
  } catch (e) {
    return { pushed: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pushDaySummaryToCloud(summary: DaySummary): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const sb = getSupabase()!;
    const userId = await ensureUserId();
    if (!userId) return;
    await sb.from("day_summaries").upsert({
      user_id: userId,
      date_key: summary.date,
      payload: summary,
      updated_at: new Date().toISOString(),
    });
  } catch {
    /* non-fatal */
  }
}
