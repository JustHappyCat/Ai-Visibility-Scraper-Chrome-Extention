// Byte-aware local-storage retention policy.

import { compactRunEnvelope, compactScrapeEnvelope, isTerminalRun } from "./lifecycle.js";

export const STORAGE_SCHEMA_VERSION = 2;
export const DEFAULT_STORAGE_BUDGET_BYTES = 8 * 1024 * 1024;
export const DEFAULT_HISTORY_LIMIT = 20;

export function serializedBytes(value) {
  const json = JSON.stringify(value ?? null);
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(json).byteLength;
  return unescape(encodeURIComponent(json)).length;
}

export function pruneHistory(history, {
  baseBytes = 0,
  budgetBytes = DEFAULT_STORAGE_BUDGET_BYTES,
  maxRuns = DEFAULT_HISTORY_LIMIT,
} = {}) {
  const kept = Array.isArray(history) ? history.slice(0, maxRuns) : [];
  const removed = Array.isArray(history) ? history.slice(maxRuns) : [];

  while (kept.length && baseBytes + serializedBytes(kept) > budgetBytes) {
    removed.unshift(kept.pop());
  }

  return {
    history: kept,
    removedIds: removed.map((run) => run?.id).filter(Boolean),
    bytes: baseBytes + serializedBytes(kept),
    pruned: removed.length,
  };
}

function deduplicateHistory(history) {
  const seen = new Set();
  return (Array.isArray(history) ? history : []).filter((run) => {
    if (!run || typeof run !== "object" || !run.id || seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  });
}

export function compactLegacyLast(value) {
  if (!value || typeof value !== "object") return null;
  if (value.kind === "run" || value.kind === "scrape") return value;
  if (value.run && typeof value.run === "object") {
    return compactRunEnvelope(value.run, { ok: value.ok !== false, error: value.error, timestamp: value.ts });
  }
  if (value.result && typeof value.result === "object") {
    if (value.result.id) {
      return compactRunEnvelope(value.result, { ok: value.ok !== false, error: value.error, timestamp: value.ts });
    }
    return compactScrapeEnvelope(value.result, { timestamp: value.ts });
  }
  if (value.ok === false) {
    return { kind: "error", ok: false, error: String(value.error || "Unknown error"), ts: value.ts || Date.now() };
  }
  return null;
}

export function migrateStoredState(state) {
  const current = state && typeof state === "object" ? { ...state } : {};
  const version = Number(current.geoSchemaVersion || 0);
  if (version > STORAGE_SCHEMA_VERSION) {
    throw new Error(`Stored data schema ${version} is newer than supported schema ${STORAGE_SCHEMA_VERSION}.`);
  }
  let history = deduplicateHistory(current.geoHistory);
  let run = current.geoRun && typeof current.geoRun === "object" ? current.geoRun : null;
  if (isTerminalRun(run)) {
    history = deduplicateHistory([run, ...history]);
    run = null;
  }
  return {
    ...current,
    geoRun: run,
    geoHistory: history,
    geoLast: compactLegacyLast(current.geoLast),
    geoSchemaVersion: STORAGE_SCHEMA_VERSION,
  };
}
