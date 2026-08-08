import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildCsv,
  buildReport,
  csvEscape,
  esc,
  percent,
  validateConfig,
} from "../../src/popup/popup.js";

const popupHtml = await readFile(new URL("../../src/popup/popup.html", import.meta.url), "utf8");

function sampleRun(overrides = {}) {
  return {
    id: "geo-test",
    status: "complete",
    completed: 1,
    total: 1,
    failed: 0,
    results: [
      {
        prompt: "Who recommends Acme?",
        engine: "chatgpt",
        status: "ok",
        answerText: "Acme is recommended.",
        thinkingText: "",
        url: "https://chatgpt.com/",
        timestamp: "2026-08-08T00:00:00.000Z",
        sources: [{ domain: "example.com", url: "https://example.com/", text: "Example" }],
        matches: [
          {
            business: "Acme",
            mentioned: true,
            inText: true,
            inAnswer: true,
            inThinking: false,
            inSources: false,
            snippets: [{ snippet: "Acme is recommended." }],
          },
        ],
      },
    ],
    errors: [],
    ...overrides,
  };
}

test("HTML escaping handles every character used at report text boundaries", () => {
  assert.equal(esc(`<script data-x="1">&`), "&lt;script data-x=&quot;1&quot;&gt;&amp;");
});

test("CSV escaping neutralizes formulas after whitespace and control characters", () => {
  assert.equal(csvEscape("=2+2"), "'=2+2");
  assert.equal(csvEscape(" \t=2+2"), "' \t=2+2");
  assert.equal(csvEscape("\u200b@SUM(A1:A2)"), "'\u200b@SUM(A1:A2)");
  assert.equal(csvEscape("-42.5"), "-42.5");
  assert.equal(csvEscape("a,\"b\"\r\nc"), '"a,""b""\r\nc"');
});

test("CSV export retains validity fields and safely handles hostile large text", () => {
  const largeFormula = `\t=HYPERLINK(\"https://evil.invalid\")${"x".repeat(100000)}`;
  const run = sampleRun();
  run.results[0].prompt = "+CMD|' /C calc'!A0";
  run.results[0].answerText = largeFormula;
  run.results[0].sources[0].text = "Unicode: café 東京";

  const csv = buildCsv(run);
  assert.ok(csv.startsWith("\ufeffrun_id,"));
  assert.ok(csv.includes("classification_reason,visibility_eligible,error"));
  assert.ok(csv.includes("success,ok,Yes"));
  assert.ok(csv.includes("'+CMD|' /C calc'!A0"));
  assert.ok(csv.includes("'\t=HYPERLINK"));
  assert.ok(csv.includes("café 東京"));
  assert.ok(csv.length > 100000);
  assert.ok(csv.includes("\r\n"));
});

test("CSV export includes technical failures that have no result or target match", () => {
  const csv = buildCsv(sampleRun({
    results: [],
    failed: 1,
    errors: [{
      prompt: "Broken prompt",
      engine: "perplexity",
      reason: "rate-limit",
      error: "Try later",
      timestamp: "2026-08-08T00:00:00.000Z",
    }],
  }));

  assert.ok(csv.includes("rate-limit,failure,rate-limit,No,Try later"));
});

test("HTML report escapes hostile values and explains denominator semantics", () => {
  const run = sampleRun({ id: `</title><script>alert("x")</script>` });
  run.results[0].prompt = "<img src=x onerror=alert(1)>";
  run.results[0].matches[0].business = "<svg onload=alert(1)>";
  run.errors = [{ prompt: "<script>bad()</script>", error: "</td><script>bad()</script>" }];

  const report = buildReport(run);
  assert.ok(!report.includes("<script>alert"));
  assert.ok(!report.includes("<img src=x"));
  assert.ok(!report.includes("<svg onload"));
  assert.ok(report.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  assert.ok(report.includes("Content-Security-Policy"));
  assert.ok(report.includes("successfully extracted answers"));
  assert.ok(report.includes("<th>Validity</th>"));
  assert.ok(report.includes("<h2>Failures</h2>"));
});

test("visibility percentages do not display zero when no eligible result exists", () => {
  assert.equal(percent(0, 0), "N/A");
  assert.equal(percent(1, 3), "33%");
});

test("form validation reports actionable field-specific errors", () => {
  const invalid = validateConfig({
    prompts: "",
    targets: "Acme | alias | not a domain",
    engines: [],
    throttleMs: "NaN",
    retries: "3",
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.prompts, /prompt/i);
  assert.match(invalid.errors.targets, /Line 1/);
  assert.match(invalid.errors.engines, /engine/i);
  assert.match(invalid.errors.throttle, /0 to 600000/);
  assert.match(invalid.errors.retries, /0 to 2/);

  assert.equal(validateConfig({
    prompts: "One prompt",
    targets: "",
    engines: [],
    throttleMs: "0",
    retries: "0",
  }, { requireTargets: false, requireEngines: false }).valid, true);
});

test("popup markup exposes accessible status, error, and field relationships", () => {
  assert.match(popupHtml, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(popupHtml, /id="formErrorSummary"[^>]*role="alert"/);
  assert.match(popupHtml, /id="prompts"[^>]*aria-describedby="prompts-note prompts-error"/);
  assert.match(popupHtml, /role="group" aria-labelledby="engines-heading" aria-describedby="engines-error"/);
  assert.match(popupHtml, /id="output"[^>]*aria-labelledby="output-heading"[^>]*aria-busy="false"/);

  const ids = [...popupHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "element IDs must be unique");
});

test("popup CSS permits narrow layouts and includes reduced-motion and focus affordances", () => {
  assert.doesNotMatch(popupHtml, /min-width:\s*(?:620|720)px/);
  assert.match(popupHtml, /@media \(max-width: 420px\)/);
  assert.match(popupHtml, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(popupHtml, /button:focus-visible/);
});
