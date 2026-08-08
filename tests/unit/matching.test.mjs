import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichResult,
  findBoundedTerm,
  hostnameMatches,
  matchTarget,
} from "../../src/core/matching.js";

test("name matching uses lexical boundaries", () => {
  assert.equal(findBoundedTerm("A CAT appears", "cat").term, "CAT");
  assert.equal(findBoundedTerm("Concatenate these values", "cat"), null);
  assert.equal(findBoundedTerm("Try Acme.AI today", "Acme.AI").term, "Acme.AI");
});

test("hostname matching accepts exact hosts and subdomains only", () => {
  assert.equal(hostnameMatches("https://www.example.com/path", "example.com"), true);
  assert.equal(hostnameMatches("news.example.com", "example.com"), true);
  assert.equal(hostnameMatches("notexample.com", "example.com"), false);
  assert.equal(hostnameMatches("example.com.evil.test", "example.com"), false);
});

test("source domains are matched structurally instead of as URL substrings", () => {
  const target = { name: "Orchard", aliases: [], domains: ["example.com"] };
  const result = {
    answerText: "No target here.",
    thinkingText: "",
    sources: [
      { url: "https://example.com.evil.test/path", text: "Unrelated" },
      { url: "https://docs.example.com/reference", text: "Reference" },
    ],
  };
  const match = matchTarget(result, target);

  assert.equal(match.inSources, true);
  assert.equal(match.snippets.filter((item) => item.where === "source").length, 1);
});

test("enriched results expose target-level and aggregate visibility", () => {
  const result = enrichResult(
    { engine: "chatgpt", status: "ok", answerText: "Acme is present.", sources: [] },
    "Who is present?",
    [
      { name: "Acme", aliases: [], domains: [] },
      { name: "Other", aliases: [], domains: [] },
    ],
    () => ({ kind: "success", eligible: true, reason: "ok" })
  );

  assert.equal(result.prompt, "Who is present?");
  assert.deepEqual(result.visibility, { businessCount: 2, mentionedCount: 1 });
  assert.equal(result.classification.eligible, true);
});
