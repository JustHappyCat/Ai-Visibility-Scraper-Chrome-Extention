import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ENGINES = new Set(["chatgpt", "google-aio", "perplexity"]);
const STATUSES = new Set([
  "ok",
  "no-ai-overview",
  "ai-overview-empty",
  "no-answer-found",
  "login-required",
  "rate-limited",
  "generation-interrupted",
  "error",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateFixtureMetadata(metadata, file = "fixture metadata") {
  assert(metadata && typeof metadata === "object", `${file}: metadata must be an object`);
  assert(metadata.schemaVersion === 1, `${file}: schemaVersion must be 1`);
  assert(ENGINES.has(metadata.engine), `${file}: unsupported engine`);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.state || ""), `${file}: invalid state`);
  assert(typeof metadata.description === "string" && metadata.description.trim(), `${file}: description is required`);
  assert(metadata.source === "synthetic" || metadata.source === "sanitized", `${file}: source must be synthetic or sanitized`);
  assert(metadata.expected && typeof metadata.expected === "object", `${file}: expected result is required`);
  assert(STATUSES.has(metadata.expected.status), `${file}: unsupported expected status`);
  assert(metadata.sanitization?.containsPersonalData === false, `${file}: personal-data declaration must be false`);
  assert(metadata.sanitization?.containsAuthenticationData === false, `${file}: authentication-data declaration must be false`);
  return metadata;
}

export function validateFixtureHtml(html, file = "fixture HTML") {
  const forbidden = [
    [/\b(?:cookie|authorization)\s*:/i, "request credential"],
    [/\b(?:access|refresh|id)[_-]?token\b/i, "authentication token"],
    [/[?&](?:gclid|fbclid|utm_[a-z]+)=/i, "tracking parameter"],
    [/<(?:html|head|body)\b/i, "full-page capture"],
    [/<script\b/i, "script content"],
  ];

  assert(typeof html === "string" && html.trim(), `${file}: fragment must not be empty`);
  for (const [pattern, label] of forbidden) {
    assert(!pattern.test(html), `${file}: contains forbidden ${label}`);
  }
  return html;
}

export async function discoverFixtures(fixturesRoot) {
  const cases = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("_")) await visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".case.json")) {
        const base = absolutePath.slice(0, -".case.json".length);
        const metadata = JSON.parse(await readFile(absolutePath, "utf8"));
        const htmlPath = `${base}.fragment.html`;
        const html = await readFile(htmlPath, "utf8");
        cases.push({ metadataPath: absolutePath, htmlPath, metadata, html });
      }
    }
  }

  await visit(fixturesRoot);
  return cases;
}
