import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  discoverFixtures,
  validateFixtureHtml,
  validateFixtureMetadata,
} from "../helpers/fixture-contract.mjs";

const fixturesRoot = path.resolve("tests/fixtures");

test("fixture metadata contract accepts a sanitized synthetic case", () => {
  const metadata = validateFixtureMetadata({
    schemaVersion: 1,
    engine: "google-aio",
    state: "overview-expanded",
    description: "A synthetic expanded overview.",
    source: "synthetic",
    expected: { status: "ok" },
    sanitization: {
      containsPersonalData: false,
      containsAuthenticationData: false,
    },
  });

  assert.equal(metadata.engine, "google-aio");
});

test("fixture contract rejects unsafe captures", () => {
  assert.throws(
    () => validateFixtureHtml("<html><body>full capture</body></html>"),
    /full-page capture/
  );
  assert.throws(
    () => validateFixtureHtml('<a href="https://example.com/?utm_source=private">link</a>'),
    /tracking parameter/
  );
});

test("all registered adapter fixture pairs satisfy the contract", async (t) => {
  const fixtures = await discoverFixtures(fixturesRoot);
  if (!fixtures.length) t.diagnostic("No adapter fixtures registered yet; use tests/fixtures/_template.");

  for (const fixture of fixtures) {
    validateFixtureMetadata(fixture.metadata, fixture.metadataPath);
    validateFixtureHtml(fixture.html, fixture.htmlPath);
  }
});
