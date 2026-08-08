import { spawnSync } from "node:child_process";
import path from "node:path";

import { projectRoot, relativePath, walkFiles } from "./lib/files.mjs";

const roots = ["src", "scripts", "tests"];
const files = [];

for (const root of roots) {
  files.push(
    ...(await walkFiles(path.join(projectRoot, root), {
      include: (file) => file.endsWith(".js") || file.endsWith(".mjs"),
      skipDirectories: new Set(["fixtures"]),
    }))
  );
}

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${relativePath(file)}\n`);
  }
}

if (failed) process.exit(1);
console.log(`Syntax check passed (${files.length} files).`);
