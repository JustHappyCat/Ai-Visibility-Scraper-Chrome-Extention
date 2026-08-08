import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRunUpdateAllowed,
  compactRunEnvelope,
  compactScrapeEnvelope,
  failureResult,
  isTerminalRun,
} from "../../src/core/lifecycle.js";

test("run transitions reject stale, terminal, and cancellation-reversing updates", () => {
  assert.equal(assertRunUpdateAllowed({ id: "a", status: "running" }, "a", "complete"), true);
  assert.throws(() => assertRunUpdateAllowed({ id: "a", status: "running" }, "b", "running"), /no longer active/);
  assert.throws(() => assertRunUpdateAllowed({ id: "a", status: "complete" }, "a", "complete"), /already complete/);
  assert.throws(() => assertRunUpdateAllowed({ id: "a", status: "cancelling" }, "a", "running"), /Invalid run transition/);
  assert.equal(isTerminalRun({ status: "cancelled" }), true);
});

test("last-value envelopes contain summaries rather than full result text", () => {
  const runEnvelope = compactRunEnvelope({ id: "r", status: "running", completed: 1, total: 2, failed: 0 }, { timestamp: 1 });
  assert.deepEqual(runEnvelope.run, { id: "r", status: "running", completed: 1, total: 2, failed: 0 });
  assert.equal("results" in runEnvelope.run, false);

  const scrapeEnvelope = compactScrapeEnvelope({ engine: "chatgpt", status: "ok", answerText: "private" }, { timestamp: 2 });
  assert.deepEqual(scrapeEnvelope.result, { engine: "chatgpt", status: "ok", timestamp: null });
});

test("synthetic failures preserve target rows without making them eligible", () => {
  const result = failureResult("chatgpt", "prompt", [{ name: "Acme", aliases: [], domains: [] }], "network");
  assert.equal(result.status, "extraction-error");
  assert.equal(result.matches[0].mentioned, false);
  assert.equal(result.classification.eligible, false);
});
