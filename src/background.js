// background.js - batch runner and active-tab dispatcher.

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
const REUSABLE_SESSION_LIMIT = 5;
let cancelRequested = false;
let resetRequested = false;
let activeRunPromise = null;
const activeTempTabIds = new Set();

async function openDashboardWindow() {
  const url = chrome.runtime.getURL("src/popup/popup.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing && existing.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.windows.create({
    url,
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

async function storageSet(values) {
  if (resetRequested) return;
  await chrome.storage.local.set(values);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab.");
  return tab;
}

async function ensureInjected(tab) {
  const liveTab = tab && tab.id ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
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

function numberOr(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parsePrompts(raw) {
  return String(raw || "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTargets(raw) {
  return String(raw || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      const name = parts[0];
      const aliases = splitList(parts[1]);
      const domains = splitList(parts[2]).map(cleanDomain);
      if (!parts[1] && !parts[2] && line.includes(",")) {
        const values = splitList(line);
        return {
          name: values[0] || name,
          aliases: values.slice(1).filter((v) => !looksLikeDomain(v)),
          domains: values.filter(looksLikeDomain).map(cleanDomain),
        };
      }
      return { name, aliases, domains };
    })
    .filter((target) => target.name);
}

function splitList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function looksLikeDomain(value) {
  return /(^|\.)[a-z0-9-]+\.[a-z]{2,}($|\/)/i.test(value);
}

function cleanDomain(value) {
  try {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
  } catch (e) {
    return String(value || "").replace(/^www\./, "").toLowerCase();
  }
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTerm(text, term, loose) {
  if (!term) return null;
  const source = String(text || "");
  if (!source) return null;
  if (loose) {
    const index = normalizeText(source).indexOf(normalizeText(term));
    return index >= 0 ? { index, term } : null;
  }
  const rx = new RegExp(`(^|[^a-z0-9])(${escapeRegex(term)})(?=$|[^a-z0-9])`, "i");
  const match = source.match(rx);
  if (!match) return null;
  return { index: match.index + (match[1] ? match[1].length : 0), term: match[2] };
}

function snippet(text, index, size = 90) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const start = Math.max(0, index - size);
  const end = Math.min(source.length, index + size);
  return `${start > 0 ? "..." : ""}${source.slice(start, end)}${end < source.length ? "..." : ""}`;
}

function matchTarget(result, target) {
  const answerText = result.answerText || "";
  const thinkingText = result.thinkingText || "";
  const sourceText = (result.sources || [])
    .map((source) => `${source.domain || ""} ${source.url || ""} ${source.text || ""}`)
    .join(" ");
  const terms = [target.name, ...(target.aliases || [])].filter(Boolean);
  const domains = (target.domains || []).filter(Boolean);
  const answerHits = [];
  const thinkingHits = [];
  const sourceHits = [];
  const searchTerms = [...terms, ...domains];

  for (const term of terms) {
    const hit = findTerm(answerText, term, false);
    if (hit) answerHits.push({ term, snippet: snippet(answerText, hit.index), where: "answer" });
  }
  for (const domain of domains) {
    const hit = findTerm(answerText, domain, true);
    if (hit) answerHits.push({ term: domain, snippet: snippet(answerText, hit.index), where: "answer" });
  }
  for (const term of searchTerms) {
    const hit = findTerm(thinkingText, term, true);
    if (hit) thinkingHits.push({ term, snippet: snippet(thinkingText, hit.index), where: "thinking" });
  }
  for (const term of searchTerms) {
    const hit = findTerm(sourceText, term, true);
    if (hit) sourceHits.push({ term, snippet: snippet(sourceText, hit.index), where: "source" });
  }

  const mentioned = answerHits.length > 0 || thinkingHits.length > 0 || sourceHits.length > 0;
  return {
    business: target.name,
    aliases: target.aliases || [],
    domains,
    mentioned,
    inText: answerHits.length > 0,
    inAnswer: answerHits.length > 0,
    inThinking: thinkingHits.length > 0,
    inSources: sourceHits.length > 0,
    snippets: [...answerHits, ...thinkingHits, ...sourceHits].slice(0, 5),
  };
}

function enrichResult(result, prompt, targets) {
  const clean = Object.assign({}, result, { prompt });
  clean.matches = targets.map((target) => matchTarget(clean, target));
  clean.visibility = {
    businessCount: clean.matches.length,
    mentionedCount: clean.matches.filter((m) => m.mentioned).length,
  };
  return clean;
}

async function updateRun(patch) {
  const existing = await storageGet(RUN_KEY, null);
  const next = Object.assign({}, existing || {}, patch, { updatedAt: nowIso() });
  await storageSet({ [RUN_KEY]: next, [LAST_KEY]: { ok: true, result: next, ts: Date.now() } });
  return next;
}

async function appendHistory(run) {
  const history = await storageGet(HISTORY_KEY, []);
  const completed = Object.assign({}, run, { archivedAt: nowIso() });
  await storageSet({ [HISTORY_KEY]: [completed, ...history.filter((item) => item.id !== run.id)].slice(0, 20) });
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
  await storageSet({ [RUN_KEY]: cancelledRun, [LAST_KEY]: { ok: true, result: cancelledRun, ts: Date.now() } });
  await appendHistory(cancelledRun);
  return cancelledRun;
}

async function resetExtensionData() {
  resetRequested = true;
  cancelRequested = true;
  await closeTempTabs();
  await chrome.storage.local.clear();
  setTimeout(() => chrome.runtime.reload(), 500);
  return { ok: true, reset: true };
}

async function scrapeTab(tab) {
  const liveTab = await ensureInjected(tab);
  const response = await chrome.tabs.sendMessage(liveTab.id, { type: "SCRAPE" });
  if (!response || !response.ok) throw new Error((response && response.error) || "Scrape failed.");
  return response.result;
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
  return pollPromptJob(liveTab.id, started.result.jobId);
}

async function pollPromptJob(tabId, jobId, timeout = 210000) {
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
    if (job.status === "complete") return job.result;
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
  const throttleMs = Math.max(0, numberOr(config.throttleMs, 3000));
  const retries = Math.max(0, Math.min(2, numberOr(config.retries, 1)));
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
  await storageSet({ [SETTINGS_KEY]: config, [RUN_KEY]: run, [LAST_KEY]: { ok: true, result: run, ts: Date.now() } });

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
        ? { ok: true, result: failedRun, ts: Date.now() }
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
            const result = enrichResult(raw, prompt, current.targets);
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
          current = await updateRun({
            completed: current.completed + 1,
            failed: current.failed + 1,
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
  const tab = await getActiveTab();
  const result = await scrapeTab(tab);
  await storageSet({ [LAST_KEY]: { ok: true, result, ts: Date.now() } });
  return { ok: true, result };
}

async function handleActiveRun(msg) {
  if (activeRunPromise) throw new Error("A run is already active.");
  const tab = await getActiveTab();
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
    [LAST_KEY]: { ok: true, result: run, ts: Date.now() },
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
      finishedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await storageSet({
      [RUN_KEY]: failedRun,
      [LAST_KEY]: isCancelError(err)
        ? { ok: true, result: failedRun, ts: Date.now() }
        : { ok: false, error, ts: Date.now() },
    });
    await appendHistory(failedRun);
  }).finally(() => {
    activeRunPromise = null;
  });

  return { ok: true, started: true, runId: run.id };
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
  const result = enrichResult(raw, prompt, targets);
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
    [LAST_KEY]: { ok: true, result: completeRun, ts: Date.now() },
  });
  await appendHistory(completeRun);
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
    return {
      ok: true,
      run: await storageGet(RUN_KEY, null),
      history: await storageGet(HISTORY_KEY, []),
      settings: await storageGet(SETTINGS_KEY, null),
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

chrome.action.onClicked.addListener(() => {
  openDashboardWindow().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  handle(msg)
    .then((response) => sendResponse(response && response.ok !== undefined ? response : { ok: true, response }))
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
