import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { projectRoot, readJson, relativePath, walkFiles } from "./lib/files.mjs";

const manifestPath = path.join(projectRoot, "manifest.json");
const manifest = await readJson(manifestPath);
const failures = [];

if (manifest.manifest_version !== 3) failures.push("manifest_version must be 3");
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(manifest.version || ""))) {
  failures.push("version must contain three or four dot-separated integers");
}

const allowedHosts = new Set([
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://www.google.com/*",
  "https://www.perplexity.ai/*",
  "https://perplexity.ai/*",
]);
const allowedContentMatches = new Set([
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://www.google.com/search*",
  "https://www.perplexity.ai/*",
  "https://perplexity.ai/*",
]);

for (const host of manifest.host_permissions || []) {
  if (!allowedHosts.has(host)) failures.push(`unexpected host permission: ${host}`);
}
for (const script of manifest.content_scripts || []) {
  for (const match of script.matches || []) {
    if (!allowedContentMatches.has(match)) failures.push(`unexpected content-script match: ${match}`);
  }
}

const references = new Set();
if (manifest.background?.service_worker) references.add(manifest.background.service_worker);
if (manifest.action?.default_popup) references.add(manifest.action.default_popup);
for (const script of manifest.content_scripts || []) {
  for (const file of script.js || []) references.add(file);
  for (const file of script.css || []) references.add(file);
}
for (const icons of [manifest.icons, manifest.action?.default_icon]) {
  for (const file of Object.values(icons || {})) references.add(file);
}

for (const reference of references) {
  const absolutePath = path.resolve(projectRoot, reference);
  if (!absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
    failures.push(`manifest reference escapes the project: ${reference}`);
    continue;
  }
  try {
    const fileStats = await stat(absolutePath);
    if (!fileStats.isFile()) failures.push(`manifest reference is not a file: ${reference}`);
  } catch {
    failures.push(`manifest reference does not exist: ${reference}`);
  }
}

const extensionFiles = await walkFiles(path.join(projectRoot, "src"), {
  include: (file) => file.endsWith(".js") || file.endsWith(".html"),
});
const remoteCodePatterns = [
  { label: "dynamic eval", pattern: /\beval\s*\(/ },
  { label: "Function constructor", pattern: /\bnew\s+Function\s*\(/ },
  { label: "remote script element", pattern: /<script\b[^>]*\bsrc=["']https?:\/\//i },
  { label: "remote module import", pattern: /\bimport\s*(?:\(|[^;]*?\bfrom\s*)["']https?:\/\// },
];

for (const file of extensionFiles) {
  const contents = await readFile(file, "utf8");
  for (const { label, pattern } of remoteCodePatterns) {
    if (pattern.test(contents)) failures.push(`${relativePath(file)} contains ${label}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Manifest check passed (${references.size} referenced files, ${extensionFiles.length} source files).`);
