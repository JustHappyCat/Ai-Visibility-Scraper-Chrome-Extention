// Runtime message, configuration, and adapter-result boundary validation.

export const ENGINE_IDS = Object.freeze(["chatgpt", "google-aio", "perplexity"]);

const MESSAGE_FIELDS = Object.freeze({
  SCRAPE_ACTIVE_TAB: new Set(["type"]),
  RUN_PROMPT_ACTIVE_TAB: new Set(["type", "prompt", "config"]),
  START_BATCH_RUN: new Set(["type", "config"]),
  CANCEL_BATCH_RUN: new Set(["type"]),
  GET_GEO_STATE: new Set(["type"]),
  CLEAR_GEO_HISTORY: new Set(["type"]),
  RESET_EXTENSION_DATA: new Set(["type"]),
  SAVE_GEO_SETTINGS: new Set(["type", "config"]),
});

const CONFIG_FIELDS = new Set(["prompts", "targets", "engines", "throttleMs", "retries", "googleSearch"]);
const GOOGLE_SEARCH_FIELDS = new Set(["country", "language", "location", "device"]);
const ADAPTER_STATUSES = new Set(["ok", "no-ai-overview", "no-answer-found", "ai-overview-empty"]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertKnownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} contains unknown field: ${field}.`);
  }
}

function boundedInteger(value, fallback, min, max, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function boundedString(value, fallback, maxLength, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  if (value.length > maxLength) throw new Error(`${label} exceeds the ${maxLength}-character limit.`);
  return value;
}

export function validateConfig(value, { requireInputs = false } = {}) {
  if (!isRecord(value)) throw new Error("Configuration must be an object.");
  assertKnownFields(value, CONFIG_FIELDS, "Configuration");

  const engines = value.engines === undefined ? [] : value.engines;
  if (!Array.isArray(engines) || engines.some((engine) => typeof engine !== "string")) {
    throw new Error("Configuration engines must be an array of engine IDs.");
  }
  const uniqueEngines = [...new Set(engines)];
  const unknownEngine = uniqueEngines.find((engine) => !ENGINE_IDS.includes(engine));
  if (unknownEngine) throw new Error(`Unsupported engine: ${unknownEngine}.`);

  const googleSearchValue = value.googleSearch === undefined ? {} : value.googleSearch;
  if (!isRecord(googleSearchValue)) throw new Error("Google Search settings must be an object.");
  assertKnownFields(googleSearchValue, GOOGLE_SEARCH_FIELDS, "Google Search settings");
  const country = boundedString(googleSearchValue.country, "", 2, "Google country code").trim();
  const language = boundedString(googleSearchValue.language, "", 35, "Google language code").trim();
  const location = boundedString(googleSearchValue.location, "", 200, "Google location").trim();
  const device = boundedString(googleSearchValue.device, "desktop", 10, "Google device").trim().toLowerCase();
  if (country && !/^[a-z]{2}$/i.test(country)) {
    throw new Error("Google country code must be a two-letter country code such as IN or US.");
  }
  if (language && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) {
    throw new Error("Google language code must look like en or en-US.");
  }
  if (!["desktop", "mobile"].includes(device)) {
    throw new Error("Google device must be desktop or mobile.");
  }

  const config = {
    prompts: boundedString(value.prompts, "", 1_000_000, "Prompts"),
    targets: boundedString(value.targets, "", 1_000_000, "Targets"),
    engines: uniqueEngines,
    throttleMs: boundedInteger(value.throttleMs, 3000, 0, 600000, "Throttle"),
    retries: boundedInteger(value.retries, 1, 0, 2, "Retries"),
    googleSearch: {
      country: country.toUpperCase(),
      language,
      location,
      device,
    },
  };

  if (requireInputs && !config.prompts.trim()) throw new Error("Add at least one prompt.");
  if (requireInputs && !config.targets.trim()) throw new Error("Add at least one target business.");
  if (requireInputs && !config.engines.length) throw new Error("Select at least one engine.");
  return config;
}

export function validateMessage(value) {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Message must be an object with a string type.");
  }
  const allowed = MESSAGE_FIELDS[value.type];
  if (!allowed) throw new Error(`Unknown action: ${value.type}`);
  assertKnownFields(value, allowed, "Message");

  if (value.type === "START_BATCH_RUN" || value.type === "SAVE_GEO_SETTINGS") {
    return { type: value.type, config: validateConfig(value.config || {}, { requireInputs: value.type === "START_BATCH_RUN" }) };
  }
  if (value.type === "RUN_PROMPT_ACTIVE_TAB") {
    const prompt = boundedString(value.prompt, "", 100_000, "Prompt").trim();
    if (!prompt) throw new Error("Add a prompt first.");
    return { type: value.type, prompt, config: validateConfig(value.config || {}) };
  }
  return { type: value.type };
}

export function isTrustedRuntimeSender(sender, runtimeId, dashboardUrl) {
  if (!sender || sender.id !== runtimeId || typeof sender.url !== "string") return false;
  try {
    const actual = new URL(sender.url);
    const dashboard = new URL(dashboardUrl);
    return actual.origin === dashboard.origin && actual.pathname === dashboard.pathname;
  } catch {
    return false;
  }
}

export function validateAdapterResult(value, expectedEngine) {
  if (!isRecord(value)) throw new Error("Adapter returned an invalid result object.");
  if (value.engine !== expectedEngine) {
    throw new Error(`Adapter engine mismatch: expected ${expectedEngine}, received ${String(value.engine || "none")}.`);
  }
  if (!ADAPTER_STATUSES.has(value.status)) throw new Error(`Adapter returned unsupported status: ${String(value.status)}.`);
  for (const field of ["answerText", "thinkingText"]) {
    if (typeof value[field] !== "string") throw new Error(`Adapter result ${field} must be text.`);
  }
  if (value.answerText.length > 1_000_000) throw new Error("Adapter answer text exceeds the 1000000-character limit.");
  if (value.thinkingText.length > 500_000) throw new Error("Adapter activity text exceeds the 500000-character limit.");
  if (!Array.isArray(value.sources)) throw new Error("Adapter result sources must be an array.");
  if (value.sources.length > 500) throw new Error("Adapter result contains too many sources.");
  if (value.sources.some((source) => !isRecord(source))) {
    throw new Error("Adapter result contains an invalid source.");
  }
  const sources = value.sources
    .map((source) => ({
      url: boundedString(source.url, "", 4096, "Source URL"),
      text: boundedString(source.text, "", 20_000, "Source text"),
      domain: boundedString(source.domain, "", 255, "Source domain"),
    }))
    .filter((source) => {
      if (!source.url) return false;
      try {
        return /^https?:$/.test(new URL(source.url).protocol);
      } catch {
        return false;
      }
    });

  let debug = isRecord(value.debug) ? value.debug : {};
  try {
    if (JSON.stringify(debug).length > 100_000) debug = { note: "Adapter debug metadata omitted because it exceeded the size limit." };
  } catch {
    debug = { note: "Adapter debug metadata omitted because it was not serializable." };
  }

  return {
    ...value,
    url: boundedString(value.url, "", 10_000, "Adapter URL"),
    timestamp: boundedString(value.timestamp, "", 100, "Adapter timestamp"),
    sources,
    debug,
  };
}
