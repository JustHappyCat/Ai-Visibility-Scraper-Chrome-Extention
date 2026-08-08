import assert from "node:assert/strict";
import test from "node:test";

import {
  compactLegacyLast,
  STORAGE_SCHEMA_VERSION,
  migrateStoredState,
  pruneHistory,
  serializedBytes,
} from "../../src/core/storage-policy.js";

test("serialized byte estimates account for multibyte text", () => {
  assert.equal(serializedBytes("a"), 3);
  assert.equal(serializedBytes("😀"), 6);
});

test("history pruning enforces count while retaining newest-first entries", () => {
  const result = pruneHistory(
    [{ id: "newest" }, { id: "middle" }, { id: "oldest" }],
    { maxRuns: 2, budgetBytes: 1000 }
  );

  assert.deepEqual(result.history.map((run) => run.id), ["newest", "middle"]);
  assert.deepEqual(result.removedIds, ["oldest"]);
  assert.equal(result.pruned, 1);
});

test("history pruning enforces the byte budget and reports removals", () => {
  const history = [
    { id: "newest", answer: "a".repeat(50) },
    { id: "oldest", answer: "b".repeat(50) },
  ];
  const oneRunBudget = serializedBytes([history[0]]);
  const result = pruneHistory(history, { maxRuns: 20, budgetBytes: oneRunBudget });

  assert.deepEqual(result.history.map((run) => run.id), ["newest"]);
  assert.deepEqual(result.removedIds, ["oldest"]);
  assert.ok(result.bytes <= oneRunBudget);
});

test("storage migration is idempotent and rejects newer schemas", () => {
  const migrated = migrateStoredState({ geoSettings: { retries: 1 } });
  assert.equal(migrated.geoSchemaVersion, STORAGE_SCHEMA_VERSION);
  assert.deepEqual(migrateStoredState(migrated), migrated);
  assert.throws(
    () => migrateStoredState({ geoSchemaVersion: STORAGE_SCHEMA_VERSION + 1 }),
    /newer than supported/
  );
});

test("migration compacts legacy last values, archives terminal runs, and deduplicates history", () => {
  const terminal = { id: "run-1", status: "complete", results: [{ answerText: "large" }] };
  const migrated = migrateStoredState({
    geoRun: terminal,
    geoHistory: [terminal, { id: "run-2", status: "failed" }, terminal],
    geoLast: { ok: true, result: terminal, ts: 5 },
  });

  assert.equal(migrated.geoRun, null);
  assert.deepEqual(migrated.geoHistory.map((run) => run.id), ["run-1", "run-2"]);
  assert.deepEqual(migrated.geoLast.run, {
    id: "run-1",
    status: "complete",
    completed: 0,
    total: 0,
    failed: 0,
  });
  assert.equal(JSON.stringify(migrated.geoLast).includes("large"), false);
});

test("legacy scrape envelopes retain only result metadata", () => {
  const compact = compactLegacyLast({
    ok: true,
    result: { engine: "perplexity", status: "ok", timestamp: "then", answerText: "private" },
    ts: 10,
  });
  assert.deepEqual(compact.result, { engine: "perplexity", status: "ok", timestamp: "then" });
});
