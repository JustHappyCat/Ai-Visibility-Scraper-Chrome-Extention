import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(scriptsDirectory, "..", "..");

export async function walkFiles(directory, options = {}) {
  const { include = () => true, skipDirectories = new Set() } = options;
  const files = [];

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirectories.has(entry.name)) await visit(absolutePath);
      } else if (entry.isFile() && include(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  await visit(directory);
  return files;
}

export function relativePath(absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

export async function readJson(absolutePath) {
  return JSON.parse(await readFile(absolutePath, "utf8"));
}
