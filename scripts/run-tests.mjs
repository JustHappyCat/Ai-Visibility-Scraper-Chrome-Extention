import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { projectRoot, walkFiles } from "./lib/files.mjs";

const requestedSuite = process.argv[2];
const suites = requestedSuite ? [requestedSuite] : ["unit", "adapters", "ui"];
const unknownSuites = suites.filter((suite) => !["unit", "adapters", "ui"].includes(suite));

if (unknownSuites.length) {
  console.error(`Unknown test suite: ${unknownSuites.join(", ")}`);
  process.exit(2);
}

const testFiles = [];
for (const suite of suites) {
  const suiteDirectory = path.join(projectRoot, "tests", suite);
  if (!existsSync(suiteDirectory)) continue;
  testFiles.push(
    ...(await walkFiles(suiteDirectory, {
      include: (file) => file.endsWith(".test.mjs"),
    }))
  );
}

if (!testFiles.length) {
  console.error(`No tests found for: ${suites.join(", ")}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
