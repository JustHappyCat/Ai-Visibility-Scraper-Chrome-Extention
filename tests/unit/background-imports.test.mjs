import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { projectRoot } from "../../scripts/lib/files.mjs";

test("background imports every core export that it references", async () => {
  const background = await readFile(path.join(projectRoot, "src", "background.js"), "utf8");
  const coreFiles = [
    "contracts.js",
    "lifecycle.js",
    "matching.js",
    "parsing.js",
    "results.js",
    "storage-policy.js",
  ];

  const coreExports = new Set();
  for (const file of coreFiles) {
    const source = await readFile(path.join(projectRoot, "src", "core", file), "utf8");
    for (const match of source.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
      coreExports.add(match[1]);
    }
  }

  const importedCoreNames = new Set();
  for (const match of background.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']\.\/core\/[^"']+["'];/g)) {
    for (const specifier of match[1].split(",")) {
      const imported = specifier.trim().split(/\s+as\s+/).at(-1);
      if (imported) importedCoreNames.add(imported);
    }
  }

  const missingImports = [...coreExports]
    .filter((name) => new RegExp(`\\b${name}\\b`).test(background))
    .filter((name) => !importedCoreNames.has(name));

  assert.deepEqual(missingImports, []);
});
