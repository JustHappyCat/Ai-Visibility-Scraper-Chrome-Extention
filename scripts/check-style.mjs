import { readFile } from "node:fs/promises";
import path from "node:path";

import { projectRoot, relativePath, walkFiles } from "./lib/files.mjs";

const roots = ["src", "scripts", "tests"];
const files = [];
for (const root of roots) {
  files.push(
    ...(await walkFiles(path.join(projectRoot, root), {
      include: (file) => /\.(?:js|mjs|json)$/.test(file),
      skipDirectories: new Set(["fixtures"]),
    }))
  );
}
files.push(path.join(projectRoot, "manifest.json"), path.join(projectRoot, "package.json"));

const failures = [];
for (const file of [...new Set(files)]) {
  const contents = await readFile(file, "utf8");
  const displayPath = relativePath(file);

  if (contents.includes("\t")) failures.push(`${displayPath}: tab character found`);
  if (!contents.endsWith("\n")) failures.push(`${displayPath}: missing final newline`);
  if (contents.includes("\r")) failures.push(`${displayPath}: use LF line endings`);

  contents.split("\n").forEach((line, index) => {
    if (/[ \t]+$/.test(line)) failures.push(`${displayPath}:${index + 1}: trailing whitespace`);
    if (/^(?:<{7}|={7}|>{7})(?: |$)/.test(line)) {
      failures.push(`${displayPath}:${index + 1}: merge-conflict marker`);
    }
  });
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Style check passed (${new Set(files).size} files).`);
