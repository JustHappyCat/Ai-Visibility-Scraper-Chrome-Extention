// background.js - batch runner and active-tab dispatcher.

import {
  parseBoundedInteger,
  parsePrompts,
  parseTargets,
} from "./core/parsing.js";
import { enrichResult } from "./core/matching.js";
import { classifyResult } from "./core/results.js";
import {
  isTrustedRuntimeSender,
  validateAdapterResult,
  validateMessage,
} from "./core/contracts.js";
import {
  assertRunUpdateAllowed,
  compactRunEnvelope,
  compactScrapeEnvelope,
  failureResult,
} from "./core/lifecycle.js";
import {
  DEFAULT_STORAGE_BUDGET_BYTES,
  migrateStoredState,
  pruneHistory,
  serializedBytes,
  STORAGE_SCHEMA_VERSION,
} from "./core/storage-policy.js";

const ENGINES = {
  chatgpt: {
    label: "ChatGPT",
    home: "https://chatgpt.com/?temporary-chat=true",
    adapter: "src/adapters/chatgpt.js",
    matches: [/^https:\/\/chatgpt\.com\//, /^https:\/\/chat\.openai\.com\//],
  },
  "google-aio": {
    label: "Google AI Overview",
    home: "https://www.google.com/search",
    adapter: "src/adapters/google-aio.js",
    matches: [/^https:\/\/www\.google\.com\/search/],
  },
  perplexity: {
    label: "Perplexity",
    home: "https://www.perplexity.ai/",
    adapter: "src/adapters/perplexity.js",
    matches: [/^https:\/\/(www\.)?perplexity\.ai\//],
  },
};

const RUN_KEY = "geoRun";
const LAST_KEY = "geoLast";
const HISTORY_KEY = "geoHistory";
const SETTINGS_KEY = "geoSettings";
const SCHEMA_KEY = "geoSchemaVersion";
const STORAGE_NOTICE_KEY = "geoStorageNotice";
const MANUAL_TARGET_KEY = "geoManualTarget";
const REUSABLE_SESSION_LIMIT = 5;
const DASHBOARD_URL = chrome.runtime.getURL("src/popup/popup.html");
let cancelRequested = false;
let resetRequested = false;
let activeRunPromise = null;
let storageInitializationPromise = null;
const activeTempTabIds = new Set();
const terminalRunIds = new Set();
const supportedTabRecency = new Map();
let originatingManualTarget = null;
let lastSupportedTarget = null;
let recencySequence = 0;
let lastSupportedSequence = 0;

async function openDashboardWindow() {
  const [existing] = await chrome.tabs.query({ url: DASHBOARD_URL });
  if (existing && Number.isInteger(existing.id)) {
    await chrome.tabs.update(existing.id, { active: true });
    if (Number.isInteger(existing.windowId)) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.windows.create({
    url: DASHBOARD_URL,
    type: "normal",
    width: 820,
    height: 920,
    focused: true,
  });
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCancelError(err) {
  return String((err && err.message) || err).toLowerCase().includes("cancelled");
}

async function sleepCancellable(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cancelRequested) throw new Error("Run cancelled.");
    await sleep(Math.min(250, end - Date.now()));
  }
}

function engineForUrl(url) {
  return Object.entries(ENGINES).find(([, cfg]) => cfg.matches.some((rx) => rx.test(url || "")));
}

function adapterForUrl(url) {
  const found = engineForUrl(url);
  return found ? found[1].adapter : null;
}

function isSupportedTab(tab) {
  return Boolean(tab && Number.isInteger(tab.id) && engineForUrl(tab.url || ""));
}

function manualTargetFromTab(tab) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
  };
}

function rememberSupportedTab(tab, sequence = ++recencySequence) {
  if (!isSupportedTab(tab)) return;
  supportedTabRecency.set(tab.id, Math.max(sequence, supportedTabRecency.get(tab.id) || 0));
  if (sequence >= lastSupportedSequence) {
    lastSupportedSequence = sequence;
    lastSupportedTarget = manualTargetFromTab(tab);
  }
}

function selectedTabSummary(tab) {
  const found = engineForUrl(tab.url || "");
  if (!found) return null;
  const [engine, config] = found;
  let hostname = "";
  try {
    hostname = new URL(tab.url).hostname;
  } catch (_err) {
    // Supported engine URLs are valid HTTPS URLs; retain an empty hostname if
    // Chrome reports a transient value while a tab is navigating.
  }
  return { engine, label: config.label, title: tab.title || "", hostname };
}

async function persistManualTarget(target) {
  // Session storage survives an MV3 service-worker restart without retaining the
  // page selection beyond the current browser session.
  if (!chrome.storage.session) return;
  if (target) {
    await chrome.storage.session.set({ [MANUAL_TARGET_KEY]: target });
  } else {
    await chrome.storage.session.remove(MANUAL_TARGET_KEY);
  }
}

async function captureManualOrigin(tab) {
  originatingManualTarget = isSupportedTab(tab) ? manualTargetFromTab(tab) : null;
  if (originatingManualTarget) rememberSupportedTab(tab);
  await persistManualTarget(originatingManualTarget).catch(() => {});
}

async function restoreManualOrigin() {
  if (originatingManualTarget || !chrome.storage.session) return originatingManualTarget;
  const stored = await chrome.storage.session.get(MANUAL_TARGET_KEY).catch(() => ({}));
  const target = stored && stored[MANUAL_TARGET_KEY];
  if (target && Number.isInteger(target.tabId)) originatingManualTarget = target;
  return originatingManualTarget;
}

async function resolveSupportedTarget(target) {
  if (!target || !Number.isInteger(target.tabId)) return null;
  const tab = await chrome.tabs.get(target.tabId).catch(() => null);
  if (!isSupportedTab(tab)) return null;
  if (Number.isInteger(target.windowId) && tab.windowId !== target.windowId) return null;
  return tab;
}

function compareSupportedTabs(a, b) {
  const sequenceDifference = (supportedTabRecency.get(b.id) || 0) - (supportedTabRecency.get(a.id) || 0);
  if (sequenceDifference) return sequenceDifference;

  const accessDifference = (Number(b.lastAccessed) || 0) - (Number(a.lastAccessed) || 0);
  if (accessDifference) return accessDifference;

  // Stable tie-breakers make selection predictable on Chrome versions that do
  // not expose lastAccessed.
  if (a.active !== b.active) return a.active ? -1 : 1;
  if (a.windowId !== b.windowId) return b.windowId - a.windowId;
  return b.id - a.id;
}

async function getManualTargetTab() {
  const origin = await resolveSupportedTarget(await restoreManualOrigin());
  if (origin) return origin;

  if (originatingManualTarget) {
    originatingManualTarget = null;
    await persistManualTarget(null).catch(() => {});
  }

  const recent = await resolveSupportedTarget(lastSupportedTarget);
  if (recent) return recent;

  const candidates = (await chrome.tabs.query({})).filter(isSupportedTab).sort(compareSupportedTabs);
  if (!candidates.length) {
    throw new Error("No supported page is available. Open ChatGPT, Google Search, or Perplexity and try again.");
  }
  rememberSupportedTab(candidates[0]);
  return candidates[0];
}

function engineUrl(engine, prompt) {
  if (engine === "google-aio") {
    return `${ENGINES[engine].home}?q=${encodeURIComponent(prompt)}`;
  }
  return ENGINES[engine].home;
}

function canReuseEngineTab(engine) {
  return engine === "chatgpt" || engine === "perplexity";
}

async function storageGet(key, fallback) {
  const obj = await chrome.storage.local.get(key);
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
}

async function ensureStorageInitialized() {
  if (!storageInitializationPromise) {
    storageInitializationPromise = (async () => {
      const stored = await chrome.storage.local.get(null);
      const migrated = migrateStoredState(stored);
      if (JSON.stringify(stored) !== JSON.stringify(migrated)) {
        await chrome.storage.local.set(migrated);
      }
      return migrated;
    })().catch((error) => {
      storageInitializationPromise = null;
      throw error;
    });
  }
  return storageInitializationPromise;
}

async function storageSet(values) {
  if (resetRequested) return;
  const payload = { [SCHEMA_KEY]: STORAGE_SCHEMA_VERSION, ...values };
  try {
    await chrome.storage.local.set(payload);
  } catch (error) {
    const message = String((error && error.message) || error);
    if (!/quota|QUOTA_BYTES/i.test(message)) throw error;

    const stored = await chrome.storage.local.get([HISTORY_KEY, RUN_KEY, SETTINGS_KEY, LAST_KEY]);
    const originalHistory = Array.isArray(payload[HISTORY_KEY])
      ? payload[HISTORY_KEY]
      : Array.isArray(stored[HISTORY_KEY])
        ? stored[HISTORY_KEY]
        : [];
    let history = pruneHistory(originalHistory, {
      baseBytes: serializedBytes({
        [RUN_KEY]: payload[RUN_KEY] ?? stored[RUN_KEY] ?? null,
        [SETTINGS_KEY]: payload[SETTINGS_KEY] ?? stored[SETTINGS_KEY] ?? null,
        [LAST_KEY]: payload[LAST_KEY] ?? stored[LAST_KEY] ?? null,
      }),
      budgetBytes: DEFAULT_STORAGE_BUDGET_BYTES,
      maxRuns: 20,
    }).history;

    while (history.length) {
      if (history.length === originalHistory.length) history = history.slice(0, -1);
      const removedIds = originalHistory.slice(history.length).map((run) => run?.id).filter(Boolean);
      try {
        await chrome.storage.local.set({
          ...payload,
          [HISTORY_KEY]: history,
          [STORAGE_NOTICE_KEY]: { pruned: removedIds.length, removedIds, timestamp: nowIso() },
        });
        return;
      } catch (retryError) {
        if (!/quota|QUOTA_BYTES/i.test(String(retryError?.message || retryError))) throw retryError;
        history = history.slice(0, -1);
      }
    }
    throw new Error("Local storage is full. The active run was preserved; export or clear older runs, then try again.");
  }
}

async function ensureInjected(tab) {
  if (!tab || !Number.isInteger(tab.id)) throw new Error("No valid target tab is available.");
  const liveTab = await chrome.tabs.get(tab.id).catch(() => null);
  const adapter = adapterForUrl((liveTab && liveTab.url) || "");
  if (!adapter) {
    throw new Error(`Target tab is not a supported site: ${(liveTab && liveTab.url) || "unknown URL"}`);
  }
  await chrome.scripting.executeScript({
    target: { tabId: liveTab.id },
    files: ["src/common.js", adapter],
  });
  return liveTab;
}

function waitForTabComplete(tabId, timeout = 60000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for tab to load."));
    }, timeout);

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete" && !done) {
          done = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
        }
      },
      (err) => {
        // Tab was closed before we could observe it; fail fast instead of
        // waiting out the full timeout.
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(err);
      }
    );
  });
}

async function updateRun(patch) {
  const existing = await storageGet(RUN_KEY, null);
  assertRunUpdateAllowed(existing, existing?.id, patch.status || existing?.status);
  const next = Object.assign({}, existing || {}, patch, { updatedAt: nowIso() });
  await storageSet({
    [RUN_KEY]: next,
    [LAST_KEY]: compactRunEnvelope(next),
  });
  return next;
}

async function appendHistory(run) {
  const history = await storageGet(HISTORY_KEY, []);
  const settings = await storageGet(SETTINGS_KEY, null);
  const completed = Object.assign({}, run, { archivedAt: nowIso() });
  const next = [completed, ...history.filter((item) => item.id !== run.id)];
  const retained = pruneHistory(next, {
    baseBytes: serializedBytes({ run, settings }),
    budgetBytes: DEFAULT_STORAGE_BUDGET_BYTES,
    maxRuns: 20,
  });
  await storageSet({
    [HISTORY_KEY]: retained.history,
    [STORAGE_NOTICE_KEY]: retained.pruned
      ? { pruned: retained.pruned, removedIds: retained.removedIds, timestamp: nowIso() }
      : null,
  });
}

async function closeTempTabs() {
  const ids = [...activeTempTabIds];
  activeTempTabIds.clear();
  await Promise.all(ids.map((id) => chrome.tabs.remove(id).catch(() => {})));
}

async function closeReusableSession(session) {
  if (!session || !session.tabId) return;
  activeTempTabIds.delete(session.tabId);
  await chrome.tabs.remove(session.tabId).catch(() => {});
}

async function markCurrentRunCancelled() {
  cancelRequested = true;
  await closeTempTabs();
  const existing = await storageGet(RUN_KEY, null);
  if (!existing || existing.status !== "running") return null;
  const cancelledRun = Object.assign({}, existing, {
    status: "cancelled",
    current: null,
    finishedAt: nowIso(),
    updatedAt: nowIso(),
  });
  await storageSet({ [RUN_KEY]: cancelledRun, [LAST_KEY]: compactRunEnvelope(cancelledRun) });
  await appendHistory(cancelledRun);
  return cancelledRun;
}

async function resetExtensionData() {
  resetRequested = true;
  cancelRequested = true;
  originatingManualTarget = null;
  lastSupportedTarget = null;
  supportedTabRecency.clear();
  await closeTempTabs();
  await chrome.storage.local.clear();
  await persistManualTarget(null).catch(() => {});
  setTimeout(() => chrome.runtime.reload(), 500);
  return { ok: true, reset: true };
}

async function scrapeTab(tab) {
  const liveTab = await ensureInjected(tab);
  const response = await chrome.tabs.sendMessage(liveTab.id, { type: "SCRAPE" });
  if (!response || !response.ok) throw new Error((response && response.error) || "Scrape failed.");
  const found = engineForUrl(liveTab.url || "");
  if (!found) throw new Error("Scrape completed on an unsupported page.");
  return validateAdapterResult(response.result, found[0]);
}

async function runPromptInTab(tab, engine, prompt) {
  if (cancelRequested) throw new Error("Run cancelled.");
  const liveTab = await ensureInjected(tab);
  if (engine === "google-aio") {
    await sleepCancellable(5000);
    return scrapeTab(liveTab);
  }
  const started = await chrome.tabs.sendMessage(liveTab.id, { type: "RUN_PROMPT_START", prompt });
  if (!started || !started.ok || !started.result || !started.result.jobId) {
    throw new Error((started && started.error) || "Prompt job did not start.");
  }
  return pollPromptJob(liveTab.id, started.result.jobId, engine);
}

async function pollPromptJob(tabId, jobId, engine, timeout = 210000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cancelRequested) throw new Error("Run cancelled.");
    await sleepCancellable(1000);
    if (cancelRequested) throw new Error("Run cancelled.");
    const response = await chrome.tabs.sendMessage(tabId, { type: "RUN_PROMPT_STATUS", jobId });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Prompt job status failed.");
    }
    const job = response.result;
    if (job.status === "complete") return validateAdapterResult(job.result, engine);
    if (job.status === "error") throw new Error(job.error || "Prompt job failed.");
  }
  throw new Error("Timed out waiting for prompt job to finish.");
}

async function createReusableSession(engine) {
  if (cancelRequested) throw new Error("Run cancelled.");
  const tab = await chrome.tabs.create({ url: engineUrl(engine), active: false });
  activeTempTabIds.add(tab.id);
  await waitForTabComplete(tab.id);
  await sleepCancellable(1500);
  const liveTab = await chrome.tabs.get(tab.id);
  await ensureInjected(liveTab);
  return { engine, tabId: tab.id, used: 0 };
}

async function getReusableSession(engine, sessions) {
  let session = sessions[engine];
  if (session && session.used >= REUSABLE_SESSION_LIMIT) {
    await closeReusableSession(session);
    delete sessions[engine];
    session = null;
  }
  if (session) {
    const tab = await chrome.tabs.get(session.tabId).catch(() => null);
    if (tab) return session;
    activeTempTabIds.delete(session.tabId);
    delete sessions[engine];
    session = null;
  }
  session = await createReusableSession(engine);
  sessions[engine] = session;
  return session;
}

// Navigate a reused tab back to the engine home so every prompt starts a fresh
// conversation. Without this, prompts 2..N continue the previous chat and the
// answers are biased by earlier prompts in the batch.
async function resetSessionConversation(session) {
  await chrome.tabs.update(session.tabId, { url: engineUrl(session.engine) });
  await sleep(300); // let the navigation begin before watching for "complete"
  await waitForTabComplete(session.tabId);
  await sleepCancellable(1500);
}

async function runReusableEnginePrompt(engine, prompt, sessions) {
  const session = await getReusableSession(engine, sessions);
  if (cancelRequested) throw new Error("Run cancelled.");
  if (session.used > 0) await resetSessionConversation(session);
  session.used += 1;
  const tab = await chrome.tabs.get(session.tabId);
  return runPromptInTab(tab, engine, prompt);
}

async function runEnginePrompt(engine, prompt, sessions) {
  if (canReuseEngineTab(engine) && sessions) {
    return runReusableEnginePrompt(engine, prompt, sessions);
  }

  let tab;
  try {
    if (cancelRequested) throw new Error("Run cancelled.");
    tab = await chrome.tabs.create({ url: engineUrl(engine, prompt), active: false });
    activeTempTabIds.add(tab.id);
    await waitForTabComplete(tab.id);
    await sleepCancellable(engine === "google-aio" ? 2500 : 1500);
    tab = await chrome.tabs.get(tab.id);
    return await runPromptInTab(tab, engine, prompt);
  } finally {
    if (tab && tab.id) {
      activeTempTabIds.delete(tab.id);
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function startBatch(config) {
  if (activeRunPromise) throw new Error("A batch run is already active.");

  const prompts = parsePrompts(config.prompts);
  const targets = parseTargets(config.targets);
  const engines = (config.engines || []).filter((engine) => ENGINES[engine]);
  const throttleMs = parseBoundedInteger(config.throttleMs, { fallback: 3000, min: 0, max: 600000 });
  const retries = parseBoundedInteger(config.retries, { fallback: 1, min: 0, max: 2 });
  if (!prompts.length) throw new Error("Add at least one prompt.");
  if (!targets.length) throw new Error("Add at least one target business.");
  if (!engines.length) throw new Error("Select at least one engine.");

  cancelRequested = false;
  activeTempTabIds.clear();
  const run = {
    id: `geo-${Date.now()}`,
    status: "running",
    prompts,
    targets,
    engines,
    throttleMs,
    retries,
    total: prompts.length * engines.length,
    completed: 0,
    failed: 0,
    results: [],
    errors: [],
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await storageSet({ [SETTINGS_KEY]: config, [RUN_KEY]: run, [LAST_KEY]: compactRunEnvelope(run) });

  activeRunPromise = executeBatch(run).catch(async (err) => {
    const existing = await storageGet(RUN_KEY, run);
    const error = String((err && err.message) || err);
    const failedRun = Object.assign({}, existing, {
      status: isCancelError(err) ? "cancelled" : "failed",
      current: null,
      errors: isCancelError(err) ? existing.errors || [] : [...(existing.errors || []), { error, timestamp: nowIso() }],
      finishedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await storageSet({
      [RUN_KEY]: failedRun,
      [LAST_KEY]: isCancelError(err)
        ? compactRunEnvelope(failedRun)
        : { ok: false, error, ts: Date.now() },
    });
    await appendHistory(failedRun);
  }).finally(() => {
    activeRunPromise = null;
  });
  return { started: true, runId: run.id };
}

async function executeBatch(run) {
  let current = run;
  const sessions = {};
  try {
    for (const prompt of current.prompts) {
      for (const engine of current.engines) {
        if (cancelRequested) {
          current = await updateRun({ status: "cancelled", current: null, finishedAt: nowIso() });
          await appendHistory(current);
          return;
        }

        current = await updateRun({
          status: "running",
          current: { prompt, engine, label: ENGINES[engine].label },
        });

        let lastError = null;
        for (let attempt = 0; attempt <= current.retries; attempt++) {
          try {
            if (cancelRequested) throw new Error("Run cancelled.");
            const raw = await runEnginePrompt(engine, prompt, sessions);
            const result = enrichResult(raw, prompt, current.targets, classifyResult);
            if (result.classification.kind === "failure") {
              throw new Error(`Extraction failed with status: ${result.status || "unknown"}.`);
            }
            current = await updateRun({
              completed: current.completed + 1,
              results: [...current.results, result],
              current: null,
            });
            lastError = null;
            break;
          } catch (err) {
            if (isCancelError(err) || cancelRequested) {
              current = await updateRun({ status: "cancelled", current: null, finishedAt: nowIso() });
              await appendHistory(current);
              return;
            }
            if (canReuseEngineTab(engine) && sessions[engine]) {
              await closeReusableSession(sessions[engine]);
              delete sessions[engine];
            }
            lastError = String((err && err.message) || err);
            if (attempt < current.retries) await sleepCancellable(1500);
          }
        }

        if (lastError) {
          const failedResult = failureResult(engine, prompt, current.targets, lastError);
          current = await updateRun({
            completed: current.completed + 1,
            failed: current.failed + 1,
            results: [...current.results, failedResult],
            errors: [...current.errors, { prompt, engine, error: lastError, timestamp: nowIso() }],
            current: null,
          });
        }

        if (current.throttleMs) await sleepCancellable(current.throttleMs);
      }
    }

    current = await updateRun({ status: "complete", current: null, finishedAt: nowIso() });
    await appendHistory(current);
  } finally {
    await Promise.all(Object.values(sessions).map(closeReusableSession));
  }
}

async function handleActiveScrape() {
  const tab = await getManualTargetTab();
  const result = await scrapeTab(tab);
  await storageSet({ [LAST_KEY]: compactScrapeEnvelope(result) });
  return {
    ok: true,
    result,
    selectedTab: selectedTabSummary(tab),
  };
}

async function handleActiveRun(msg) {
  if (activeRunPromise) throw new Error("A run is already active.");
  const tab = await getManualTargetTab();
  const found = engineForUrl(tab.url || "");
  if (!found) throw new Error("Run requires the active tab to be ChatGPT, Google Search, or Perplexity.");
  const [engine] = found;
  const config = msg.config || {};
  const prompt = String(msg.prompt || "").trim();
  const targets = parseTargets(config.targets || "");
  if (!prompt) throw new Error("Add a prompt first.");

  cancelRequested = false;
  const run = {
    id: `geo-active-${Date.now()}`,
    status: "running",
    prompts: [prompt],
    targets,
    engines: [engine],
    throttleMs: 0,
    retries: 0,
    total: 1,
    completed: 0,
    failed: 0,
    results: [],
    errors: [],
    current: { prompt, engine, label: ENGINES[engine].label },
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await storageSet({
    [SETTINGS_KEY]: Object.assign({}, config, { prompts: config.prompts || prompt }),
    [RUN_KEY]: run,
    [LAST_KEY]: compactRunEnvelope(run),
  });

  activeRunPromise = executeActiveRun(tab.id, engine, prompt, targets, run).catch(async (err) => {
    const error = String((err && err.message) || err);
    const existing = await storageGet(RUN_KEY, run);
    const failedRun = Object.assign({}, existing, {
      status: isCancelError(err) ? "cancelled" : "failed",
      completed: 1,
      failed: isCancelError(err) ? existing.failed || 0 : 1,
      current: null,
      errors: isCancelError(err)
        ? existing.errors || []
        : [...(existing.errors || []), { prompt, engine, error, timestamp: nowIso() }],
      results: isCancelError(err)
        ? existing.results || []
        : [...(existing.results || []), failureResult(engine, prompt, targets, error)],
      finishedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await storageSet({
      [RUN_KEY]: failedRun,
      [LAST_KEY]: isCancelError(err)
        ? compactRunEnvelope(failedRun)
        : { ok: false, error, ts: Date.now() },
    });
    await appendHistory(failedRun);
  }).finally(() => {
    activeRunPromise = null;
  });

  return {
    ok: true,
    started: true,
    runId: run.id,
    selectedTab: selectedTabSummary(tab),
  };
}

async function executeActiveRun(tabId, engine, prompt, targets, run) {
  if (cancelRequested) throw new Error("Run cancelled.");
  let tab = await chrome.tabs.get(tabId);
  if (engine === "google-aio") {
    tab = await chrome.tabs.update(tabId, { url: engineUrl(engine, prompt) });
    await waitForTabComplete(tabId);
    await sleepCancellable(2500);
    tab = await chrome.tabs.get(tabId);
  }
  const raw = await runPromptInTab(tab, engine, prompt);
  const result = enrichResult(raw, prompt, targets, classifyResult);
  if (result.classification.kind === "failure") {
    throw new Error(`Extraction failed with status: ${result.status || "unknown"}.`);
  }
  const completeRun = Object.assign({}, run, {
    status: "complete",
    completed: 1,
    results: [result],
    current: null,
    finishedAt: nowIso(),
    updatedAt: nowIso(),
  });
  await storageSet({
    [RUN_KEY]: completeRun,
    [LAST_KEY]: compactRunEnvelope(completeRun),
  });
  await appendHistory(completeRun);
}

async function recoverInterruptedRun(run) {
  if (!run || run.status !== "running" || activeRunPromise) return run;
  const error = "The background service worker restarted before this run finished.";
  const interrupted = {
    ...run,
    status: "failed",
    current: null,
    errors: [...(run.errors || []), { error, reason: "worker-interrupted", timestamp: nowIso() }],
    finishedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await storageSet({ [RUN_KEY]: interrupted, [LAST_KEY]: { ok: false, error, ts: Date.now() } });
  await appendHistory(interrupted);
  return interrupted;
}

async function handle(msg) {
  if (msg.type === "SCRAPE_ACTIVE_TAB") return handleActiveScrape();
  if (msg.type === "RUN_PROMPT_ACTIVE_TAB") return handleActiveRun(msg);
  if (msg.type === "START_BATCH_RUN") return startBatch(msg.config || {});
  if (msg.type === "CANCEL_BATCH_RUN") {
    const run = await markCurrentRunCancelled();
    return { ok: true, cancelling: true, run };
  }
  if (msg.type === "GET_GEO_STATE") {
    const run = await recoverInterruptedRun(await storageGet(RUN_KEY, null));
    return {
      ok: true,
      run,
      history: await storageGet(HISTORY_KEY, []),
      settings: await storageGet(SETTINGS_KEY, null),
      storageNotice: await storageGet(STORAGE_NOTICE_KEY, null),
      schemaVersion: await storageGet(SCHEMA_KEY, STORAGE_SCHEMA_VERSION),
    };
  }
  if (msg.type === "CLEAR_GEO_HISTORY") {
    await storageSet({ [HISTORY_KEY]: [] });
    return { ok: true };
  }
  if (msg.type === "RESET_EXTENSION_DATA") return resetExtensionData();
  if (msg.type === "SAVE_GEO_SETTINGS") {
    if (resetRequested) return { ok: true, skipped: true };
    await storageSet({ [SETTINGS_KEY]: msg.config || {} });
    return { ok: true };
  }
  throw new Error("Unknown action: " + msg.type);
}

chrome.action.onClicked.addListener((tab) => {
  // Record the source before focusing or creating the dashboard window.
  captureManualOrigin(tab)
    .then(openDashboardWindow)
    .catch(() => {});
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  const sequence = ++recencySequence;
  chrome.tabs.get(activeInfo.tabId).then((tab) => rememberSupportedTab(tab, sequence)).catch(() => {});
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const sequence = ++recencySequence;
  chrome.tabs
    .query({ active: true, windowId })
    .then(([tab]) => rememberSupportedTab(tab, sequence))
    .catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  supportedTabRecency.delete(tabId);
  if (lastSupportedTarget && lastSupportedTarget.tabId === tabId) lastSupportedTarget = null;
  if (!originatingManualTarget || originatingManualTarget.tabId !== tabId) return;
  originatingManualTarget = null;
  persistManualTarget(null).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let validatedMessage;
  try {
    if (!isTrustedRuntimeSender(sender, chrome.runtime.id, DASHBOARD_URL)) {
      throw new Error("This action is only available to the extension dashboard.");
    }
    validatedMessage = validateMessage(msg);
  } catch (error) {
    sendResponse({ ok: false, error: String((error && error.message) || error) });
    return false;
  }

  ensureStorageInitialized()
    .then(() => handle(validatedMessage))
    .then((response) => sendResponse(response && response.ok !== undefined ? response : { ok: true, response }))
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
