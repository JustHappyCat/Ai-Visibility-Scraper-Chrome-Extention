import { readFile } from "node:fs/promises";

import { projectRoot, relativePath, walkFiles } from "./lib/files.mjs";

const candidates = await walkFiles(projectRoot, {
  include: (file) => /\.(?:html|js|json|md|mjs|txt|ya?ml)$/i.test(file),
  skipDirectories: new Set([".git", "coverage", "dist", "node_modules", "test-results"]),
});

const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["GitHub personal token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["generic bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}\b/i],
];
const failures = [];

for (const file of candidates) {
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  for (const [label, pattern] of patterns) {
    if (pattern.test(contents)) failures.push(`${relativePath(file)}: possible ${label}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Secret-pattern check passed (${candidates.length} files).`);
