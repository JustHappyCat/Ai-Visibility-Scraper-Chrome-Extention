import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { loadContentScript } from "../helpers/content-script-harness.mjs";

const commonPath = path.resolve("src/common.js");

test("common helpers normalize text and domains", async () => {
  const { context } = await loadContentScript(commonPath);

  assert.equal(context.GEO.text({ textContent: "  Alpha\n  Beta  " }), "Alpha Beta");
  assert.equal(context.GEO.text(null), "");
  assert.equal(context.GEO.domainOf("https://www.example.com/a?q=1"), "example.com");
  assert.equal(context.GEO.domainOf("not a URL"), "");
});

test("collectLinks rejects empty, duplicate, script, and in-page links", async () => {
  const { context } = await loadContentScript(commonPath);
  const links = context.GEO.collectLinks([
    { href: "https://www.example.com/a", textContent: " First " },
    { href: "https://www.example.com/a", textContent: "Duplicate" },
    { href: "javascript:alert(1)", textContent: "Script" },
    { href: "#section", textContent: "Section" },
    { href: "", textContent: "Empty" },
  ]);

  assert.equal(links.length, 1);
  assert.deepEqual(
    { ...links[0] },
    { url: "https://www.example.com/a", text: "First", domain: "example.com" }
  );
});

test("payload supplies the shared adapter envelope without overriding fields", async () => {
  const { context } = await loadContentScript(commonPath, {
    location: { href: "https://chatgpt.com/example" },
  });
  const payload = context.GEO.payload("chatgpt", {
    answerText: "A result",
    status: "no-answer-found",
  });

  assert.equal(payload.engine, "chatgpt");
  assert.equal(payload.url, "https://chatgpt.com/example");
  assert.equal(payload.answerText, "A result");
  assert.equal(payload.status, "no-answer-found");
  assert.deepEqual([...payload.sources], []);
  assert.deepEqual({ ...payload.debug }, {});
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("store helpers write only the geoLast envelope", async () => {
  const { context, storageWrites } = await loadContentScript(commonPath);
  await context.GEO.storeResult({ engine: "chatgpt", status: "ok" });

  assert.equal(storageWrites.length, 1);
  assert.equal(storageWrites[0].geoLast.ok, true);
  assert.equal(storageWrites[0].geoLast.result.engine, "chatgpt");
  assert.equal(typeof storageWrites[0].geoLast.ts, "number");
});
