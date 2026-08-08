import assert from "node:assert/strict";
import test from "node:test";

import { classifyResult, summarizeResults, withClassification } from "../../src/core/results.js";

test("status classification separates eligible, unavailable, and failed results", () => {
  assert.deepEqual(classifyResult({ status: "ok" }), {
    kind: "success",
    eligible: true,
    reason: "ok",
  });
  assert.deepEqual(classifyResult({ status: "no-ai-overview" }), {
    kind: "unavailable",
    eligible: false,
    reason: "no-ai-overview",
  });
  assert.deepEqual(classifyResult({ status: "no-answer-found" }), {
    kind: "failure",
    eligible: false,
    reason: "no-answer-found",
  });
  assert.equal(withClassification({ status: "ai-overview-empty" }).classification.kind, "failure");
});

test("summaries exclude unavailable and failed results from visibility denominators", () => {
  const business = "Example";
  const matches = (mentioned) => [{ business, mentioned }];
  const summary = summarizeResults({
    results: [
      { engine: "chatgpt", status: "ok", matches: matches(true) },
      { engine: "chatgpt", status: "ok", matches: matches(false) },
      { engine: "google-aio", status: "no-ai-overview", matches: matches(false) },
      { engine: "perplexity", status: "no-answer-found", matches: matches(false) },
    ],
  });

  assert.deepEqual(summary.counts, { success: 2, unavailable: 1, failure: 1 });
  assert.deepEqual(summary.byBusiness[business], {
    eligible: 2,
    mentioned: 1,
    unavailable: 1,
    failure: 1,
  });
  assert.equal(summary.byEngine["google-aio"].eligible, 0);
  assert.equal(summary.byEngine["google-aio"].unavailable, 1);
});
