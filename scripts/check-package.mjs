import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { projectRoot, relativePath, walkFiles } from "./lib/files.mjs";

const releaseRoots = ["src", "assets/icons"];
const releaseFiles = ["manifest.json", "README.md", "DOCUMENTATION.md", "LICENSE"];
const forbiddenPatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:node_modules|tests?|coverage|test-results|\.git|\.github)(?:\/|$)/i,
  /\.(?:pem|key|log)$/i,
  /(^|\/)(?:geo-results-.*\.csv|geo-report-.*\.html)$/i,
];
const allowedSourceExtensions = new Set([
  ".css",
  ".html",
  ".jpeg",
  ".jpg",
  ".js",
  ".png",
  ".svg",
  ".webp",
]);
const failures = [];
const candidates = [];
const missingReleaseFiles = new Set();

for (const root of releaseRoots) {
  candidates.push(...(await walkFiles(path.join(projectRoot, root))));
}
for (const file of releaseFiles) {
  const absolutePath = path.join(projectRoot, file);
  try {
    const fileStats = await stat(absolutePath);
    if (fileStats.isFile()) candidates.push(absolutePath);
    else failures.push(`release path is not a file: ${file}`);
  } catch {
    failures.push(`release file does not exist: ${file}`);
    missingReleaseFiles.add(file);
  }
}

for (const file of candidates) {
  const relative = relativePath(file);
  if (forbiddenPatterns.some((pattern) => pattern.test(relative))) {
    failures.push(`private/development artifact selected for release: ${relative}`);
  }
  if (relative.startsWith("src/") && !allowedSourceExtensions.has(path.extname(file).toLowerCase())) {
    failures.push(`unexpected source-package file type: ${relative}`);
  }
}

const required = [
  "manifest.json",
  "README.md",
  "DOCUMENTATION.md",
  "LICENSE",
  "src/background.js",
  "src/common.js",
];
const selected = new Set(candidates.map(relativePath));
for (const file of required) {
  if (!selected.has(file) && !missingReleaseFiles.has(file)) {
    failures.push(`required release file is missing: ${file}`);
  }
}

for (const file of candidates.filter((candidate) => candidate.endsWith(".html"))) {
  const contents = await readFile(file, "utf8");
  if (/<script\b[^>]*\bsrc=["']https?:\/\//i.test(contents)) {
    failures.push(`remote executable script in release file: ${relativePath(file)}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Package check passed (${selected.size} release files; development artifacts excluded by allowlist).`);
