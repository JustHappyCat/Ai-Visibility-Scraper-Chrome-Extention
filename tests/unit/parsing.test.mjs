import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanDomain,
  parseBoundedInteger,
  parsePrompts,
  parseTargets,
  parseTargetsDetailed,
} from "../../src/core/parsing.js";

test("prompts are newline-delimited and retain commas", () => {
  assert.deepEqual(parsePrompts(" compare cost, security \n\nsecond prompt\r\n"), [
    "compare cost, security",
    "second prompt",
  ]);
});

test("bounded integers reject fractional and nonnumeric input", () => {
  const options = { fallback: 3, min: 1, max: 10 };
  assert.equal(parseBoundedInteger("8", options), 8);
  assert.equal(parseBoundedInteger("12", options), 10);
  assert.equal(parseBoundedInteger("1.5", options), 3);
  assert.equal(parseBoundedInteger("nope", options), 3);
});

test("target parser normalizes pipe and legacy formats", () => {
  assert.deepEqual(
    parseTargets("Example Co | Example, Ex Co | www.example.com, blog.example.com\nLegacy, Alias, legacy.test"),
    [
      {
        name: "Example Co",
        aliases: ["Example", "Ex Co"],
        domains: ["example.com", "blog.example.com"],
      },
      { name: "Legacy", aliases: ["Alias"], domains: ["legacy.test"] },
    ]
  );
});

test("target parser reports invalid lines without dropping valid lines", () => {
  const parsed = parseTargetsDetailed("Good Brand\nBad | alias | not a domain");
  assert.equal(parsed.targets.length, 1);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, 2);
  assert.throws(() => parseTargets("Bad | alias | not a domain"), /line 1/);
});

test("domain normalization accepts URLs and rejects unsafe input", () => {
  assert.equal(cleanDomain("https://WWW.Example.com/path?q=1"), "example.com");
  assert.throws(() => cleanDomain("example .com"), /invalid whitespace/i);
  assert.throws(() => cleanDomain("localhost"), /invalid domain/i);
  assert.throws(() => cleanDomain("-bad.example"), /invalid domain/i);
});
