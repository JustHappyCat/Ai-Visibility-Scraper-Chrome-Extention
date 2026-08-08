import assert from "node:assert/strict";
import test from "node:test";

import { scrapeAdapter } from "../helpers/adapter-harness.mjs";

function emptyDocument() {
  return {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

test("adapter harness executes a registered scraper in an isolated browser context", async () => {
  const result = await scrapeAdapter("perplexity", {
    document: emptyDocument(),
    location: { href: "https://www.perplexity.ai/search/example" },
  });

  assert.equal(result.engine, "perplexity");
  assert.equal(result.status, "no-answer-found");
  assert.equal(result.url, "https://www.perplexity.ai/search/example");
  assert.equal(result.answerText, "");
});
