import { readFile } from "node:fs/promises";
import path from "node:path";

import { projectRoot, relativePath, walkFiles } from "./lib/files.mjs";

const files = [];
for (const root of ["src", "scripts", "tests"]) {
  files.push(
    ...(await walkFiles(path.join(projectRoot, root), {
      include: (file) => file.endsWith(".js") || file.endsWith(".mjs"),
      skipDirectories: new Set(["fixtures"]),
    }))
  );
}

const forbidden = [
  ["debugger statement", /(^|[^\w])debugger\s*;/],
  ["document.write", /\bdocument\.write\s*\(/],
  ["legacy var declaration", /(^|[;{}]\s*)var\s+[A-Za-z_$]/m],
  ["with statement", /(^|[;{}]\s*)with\s*\(/m],
];
const failures = [];

for (const file of files) {
  const contents = await readFile(file, "utf8");
  for (const [label, pattern] of forbidden) {
    const match = pattern.exec(contents);
    if (!match) continue;
    const line = contents.slice(0, match.index).split("\n").length;
    failures.push(`${relativePath(file)}:${line}: ${label}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Lint check passed (${files.length} files).`);
