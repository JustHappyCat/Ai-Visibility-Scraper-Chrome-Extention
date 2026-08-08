import assert from "node:assert/strict";
import test from "node:test";

import {
  isTrustedRuntimeSender,
  validateAdapterResult,
  validateConfig,
  validateMessage,
} from "../../src/core/contracts.js";

test("configuration validation rejects unknown engines and out-of-range integers", () => {
  assert.throws(() => validateConfig({ engines: ["other"] }), /Unsupported engine/);
  assert.throws(() => validateConfig({ throttleMs: 1.5 }), /integer/);
  assert.throws(() => validateConfig({ retries: 3 }), /0 to 2/);
  assert.deepEqual(validateConfig({ engines: ["chatgpt", "chatgpt"] }).engines, ["chatgpt"]);
});

test("message validation rejects unknown fields and normalizes valid messages", () => {
  assert.throws(() => validateMessage({ type: "GET_GEO_STATE", extra: true }), /unknown field/);
  assert.throws(() => validateMessage({ type: "DO_ANYTHING" }), /Unknown action/);
  const message = validateMessage({
    type: "RUN_PROMPT_ACTIVE_TAB",
    prompt: "  test prompt  ",
    config: { targets: "Example", engines: ["chatgpt"], throttleMs: 0, retries: 0 },
  });
  assert.equal(message.prompt, "test prompt");
  assert.equal(message.config.retries, 0);
});

test("only the extension dashboard is trusted to invoke privileged messages", () => {
  const dashboard = "chrome-extension://extension-id/src/popup/popup.html";
  assert.equal(
    isTrustedRuntimeSender({ id: "extension-id", url: `${dashboard}#state` }, "extension-id", dashboard),
    true
  );
  assert.equal(
    isTrustedRuntimeSender({ id: "extension-id", url: "https://example.com/" }, "extension-id", dashboard),
    false
  );
  assert.equal(isTrustedRuntimeSender({ id: "other", url: dashboard }, "extension-id", dashboard), false);
});

test("adapter results enforce engine and required result fields", () => {
  const result = {
    engine: "chatgpt",
    status: "ok",
    answerText: "Answer",
    thinkingText: "",
    sources: [],
  };
  const validated = validateAdapterResult(result, "chatgpt");
  assert.equal(validated.engine, "chatgpt");
  assert.deepEqual(validated.sources, []);
  assert.deepEqual(validated.debug, {});
  assert.throws(() => validateAdapterResult({ ...result, engine: "perplexity" }, "chatgpt"), /mismatch/);
  assert.throws(() => validateAdapterResult({ ...result, sources: null }, "chatgpt"), /sources/);
  assert.throws(() => validateAdapterResult({ ...result, answerText: "x".repeat(1_000_001) }, "chatgpt"), /limit/);
  assert.throws(
    () => validateAdapterResult({ ...result, sources: Array.from({ length: 501 }, () => ({})) }, "chatgpt"),
    /too many sources/
  );

  const filtered = validateAdapterResult({
    ...result,
    sources: [
      { url: "javascript:alert(1)", text: "Bad", domain: "" },
      { url: "https://safe.example.test/page", text: "Safe", domain: "safe.example.test" },
    ],
  }, "chatgpt");
  assert.deepEqual(filtered.sources, [
    { url: "https://safe.example.test/page", text: "Safe", domain: "safe.example.test" },
  ]);
});
