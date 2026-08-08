import path from "node:path";

import { loadContentScript, runContentScript } from "./content-script-harness.mjs";

const ADAPTER_PATHS = {
  chatgpt: "src/adapters/chatgpt.js",
  "google-aio": "src/adapters/google-aio.js",
  perplexity: "src/adapters/perplexity.js",
};

export async function loadAdapter(engine, overrides = {}) {
  const adapterPath = ADAPTER_PATHS[engine];
  if (!adapterPath) throw new Error(`Unsupported adapter: ${engine}`);

  const harness = await loadContentScript(path.resolve("src/common.js"), overrides);
  await runContentScript(harness.context, path.resolve(adapterPath));

  if (typeof harness.context.GEO.handlers.SCRAPE !== "function") {
    throw new Error(`${engine} did not register a SCRAPE handler`);
  }
  return harness;
}

export async function scrapeAdapter(engine, overrides = {}) {
  const harness = await loadAdapter(engine, overrides);
  return harness.context.GEO.handlers.SCRAPE({ type: "SCRAPE" });
}
