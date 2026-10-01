// popup.js - Phase 6 control surface: batch run, history, CSV, and report export.

import { classifyResult, summarizeResults } from "../core/results.js";
import { parsePrompts, parseTargetsDetailed } from "../core/parsing.js";
import { buildSearchURL } from "../core/google-search.js";

const ENGINE_LABELS = {
  chatgpt: "ChatGPT",
  "google-aio": "Google AI Overview",
  perplexity: "Perplexity",
};

const hasDocument = typeof document !== "undefined";
const byId = (id) => hasDocument ? document.getElementById(id) : null;
const promptsEl = byId("prompts");
const targetsEl = byId("targets");
const throttleEl = byId("throttle");
const retriesEl = byId("retries");
const googleCountryEl = byId("googleCountry");
const googleLanguageEl = byId("googleLanguage");
const googleLocationEl = byId("googleLocation");
const googleDeviceEl = byId("googleDevice");
const googleSearchPreviewEl = byId("googleSearchPreview");
const googleSearchPreviewLinkEl = byId("googleSearchPreviewLink");
const output = byId("output");
const announcementEl = byId("announcement");
const manualFeedbackEl = byId("manualFeedback");
const formErrorSummaryEl = byId("formErrorSummary");
const startBtn = byId("startBtn");
const cancelBtn = byId("cancelBtn");
const scrapeBtn = byId("scrapeBtn");
const runActiveBtn = byId("runActiveBtn");
const csvBtn = byId("csvBtn");
const reportBtn = byId("reportBtn");
const clearHistoryBtn = byId("clearHistoryBtn");
const resetBtn = byId("resetBtn");

let state = { run: null, history: [], settings: null, storageNotice: null };
let restoredSettings = false;
let saveTimer = null;
let resetting = false;
let lastAnnouncement = "";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[c]));
}

function selectedEngines() {
  return [...document.querySelectorAll('input[name="engine"]:checked')].map((el) => el.value);
}

function setSelectedEngines(engines) {
  document.querySelectorAll('input[name="engine"]').forEach((el) => {
    el.checked = engines.includes(el.value);
  });
}

function message(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else if (!response || !response.ok) reject(new Error((response && response.error) || "Unknown error"));
      else resolve(response);
    });
  });
}

function requestGoogleMobilePermission() {
  return chrome.permissions.request({ permissions: ["debugger"] });
}

function configFromForm() {
  return {
    prompts: promptsEl.value,
    targets: targetsEl.value,
    engines: selectedEngines(),
    throttleMs: throttleEl.value,
    retries: retriesEl.value,
    googleSearch: {
      country: googleCountryEl.value,
      language: googleLanguageEl.value,
      location: googleLocationEl.value,
      device: googleDeviceEl.value,
    },
  };
}

export function validateConfig(config, { requireTargets = true, requireEngines = true } = {}) {
  const errors = {};
  if (!parsePrompts(config?.prompts).length) errors.prompts = "Add at least one prompt, one per line.";

  const parsedTargets = parseTargetsDetailed(config?.targets);
  if (parsedTargets.errors.length) {
    errors.targets = parsedTargets.errors
      .map((item) => `Line ${item.line}: ${item.error}`)
      .join(" ");
  } else if (requireTargets && !parsedTargets.targets.length) {
    errors.targets = "Add at least one target business.";
  }

  if (requireEngines && !(config?.engines || []).length) {
    errors.engines = "Select at least one engine.";
  }

  const throttle = Number(config?.throttleMs);
  if (config?.throttleMs === "" || !Number.isInteger(throttle) || throttle < 0 || throttle > 600000) {
    errors.throttle = "Enter a whole number from 0 to 600000 milliseconds.";
  }

  const retries = Number(config?.retries);
  if (config?.retries === "" || !Number.isInteger(retries) || retries < 0 || retries > 2) {
    errors.retries = "Enter a whole number from 0 to 2.";
  }

  const googleSearch = config?.googleSearch || {};
  const country = String(googleSearch.country || "").trim();
  const language = String(googleSearch.language || "").trim();
  if (country && !/^[a-z]{2}$/i.test(country)) {
    errors.googleCountry = "Use a two-letter country code such as IN or US.";
  }
  if (language && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) {
    errors.googleLanguage = "Use a language code such as en or en-US.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

function updateGoogleSearchPreview() {
  if (!googleSearchPreviewEl || !googleSearchPreviewLinkEl) return;
  const prompt = parsePrompts(promptsEl.value)[0];
  if (!prompt) {
    googleSearchPreviewEl.textContent = "Enter a prompt to preview the Google search URL.";
    googleSearchPreviewLinkEl.hidden = true;
    googleSearchPreviewLinkEl.removeAttribute("href");
    return;
  }
  const url = buildSearchURL(prompt, configFromForm().googleSearch);
  googleSearchPreviewEl.textContent = url;
  googleSearchPreviewLinkEl.href = url;
  googleSearchPreviewLinkEl.hidden = false;
}

function queueSettingsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    message("SAVE_GEO_SETTINGS", { config: configFromForm() }).catch(() => {});
  }, 350);
}

function restoreSettings(settings) {
  if (!settings || restoredSettings) return;
  promptsEl.value = settings.prompts || "";
  targetsEl.value = settings.targets || "";
  throttleEl.value = settings.throttleMs ?? 3000;
  retriesEl.value = settings.retries ?? 1;
  const googleSearch = settings.googleSearch || {};
  googleCountryEl.value = googleSearch.country || "";
  googleLanguageEl.value = googleSearch.language || "";
  googleLocationEl.value = googleSearch.location || "";
  googleDeviceEl.value = googleSearch.device === "mobile" ? "mobile" : "desktop";
  setSelectedEngines(settings.engines || Object.keys(ENGINE_LABELS));
  restoredSettings = true;
  updateGoogleSearchPreview();
}

function activeRun() {
  return state.run || (state.history && state.history[0]) || null;
}

function allRows(run) {
  return summarizeResults(run).rows;
}

function summary(run) {
  return summarizeResults(run);
}

export function percent(part, total) {
  return total ? `${Math.round((part / total) * 100)}%` : "N/A";
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function announce(text) {
  if (!announcementEl || !text || text === lastAnnouncement) return;
  lastAnnouncement = text;
  announcementEl.textContent = "";
  // A separate DOM update makes repeated status-region changes consistently
  // discoverable by screen readers.
  requestAnimationFrame(() => {
    announcementEl.textContent = text;
  });
}

function clearGeneralError() {
  if (!formErrorSummaryEl) return;
  formErrorSummaryEl.hidden = true;
  formErrorSummaryEl.textContent = "";
}

function showGeneralError(error) {
  const detail = String(error?.message || error || "Unknown error");
  if (formErrorSummaryEl) {
    formErrorSummaryEl.textContent = `Action failed: ${detail}`;
    formErrorSummaryEl.hidden = false;
    formErrorSummaryEl.focus();
  }
  announce(`Action failed. ${detail}`);
}

const FIELD_CONTROLS = {
  prompts: () => promptsEl,
  targets: () => targetsEl,
  engines: () => hasDocument ? document.querySelector('input[name="engine"]') : null,
  throttle: () => throttleEl,
  retries: () => retriesEl,
  googleCountry: () => googleCountryEl,
  googleLanguage: () => googleLanguageEl,
};

function clearFieldError(field) {
  const errorEl = byId(`${field}-error`);
  const control = FIELD_CONTROLS[field]?.();
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
  if (control) control.removeAttribute("aria-invalid");
}

function showValidationErrors(errors) {
  clearGeneralError();
  Object.keys(FIELD_CONTROLS).forEach(clearFieldError);
  let firstControl = null;
  for (const [field, detail] of Object.entries(errors)) {
    const errorEl = byId(`${field}-error`);
    const control = FIELD_CONTROLS[field]?.();
    if (errorEl) {
      errorEl.textContent = detail;
      errorEl.hidden = false;
    }
    if (control) {
      control.setAttribute("aria-invalid", "true");
      firstControl ||= control;
    }
  }
  if (formErrorSummaryEl) {
    const count = Object.keys(errors).length;
    formErrorSummaryEl.textContent = `Fix ${count} highlighted ${count === 1 ? "field" : "fields"} before continuing.`;
    formErrorSummaryEl.hidden = false;
  }
  announce("Some inputs need attention. Review the highlighted fields.");
  firstControl?.focus();
}

function validateForm(options) {
  const validation = validateConfig(configFromForm(), options);
  if (!validation.valid) {
    showValidationErrors(validation.errors);
    return false;
  }
  clearGeneralError();
  Object.keys(FIELD_CONTROLS).forEach(clearFieldError);
  return true;
}

function selectedTabText(selectedTab) {
  if (!selectedTab) return "No supported tab was selected.";
  const label = selectedTab.label || ENGINE_LABELS[selectedTab.engine] || selectedTab.engine || "Supported page";
  const title = selectedTab.title ? ` — ${selectedTab.title}` : "";
  const hostname = selectedTab.hostname ? ` (${selectedTab.hostname})` : "";
  return `${label}${title}${hostname}`;
}

function showManualFeedback(kind, title, selectedTab, detail = "") {
  if (!manualFeedbackEl) return;
  const selected = selectedTabText(selectedTab);
  manualFeedbackEl.innerHTML = `
    <h2>${esc(title)}</h2>
    <p><span class="badge ${kind}">${esc(kind === "ok" ? "Selected tab" : "Status")}</span> ${esc(selected)}</p>
    ${detail}
  `;
  manualFeedbackEl.focus();
  announce(`${title}. ${selected}`);
}

function render() {
  const run = state.run;
  const history = state.history || [];
  const current = activeRun();
  const isRunning = run?.status === "running" || run?.status === "cancelling";
  csvBtn.disabled = !current || !(current.results || []).length;
  reportBtn.disabled = csvBtn.disabled;
  cancelBtn.disabled = !isRunning;
  startBtn.disabled = isRunning;
  runActiveBtn.disabled = isRunning;
  scrapeBtn.disabled = isRunning;
  clearHistoryBtn.disabled = isRunning || history.length === 0;
  output.setAttribute("aria-busy", String(isRunning));

  if (!current) {
    output.innerHTML = `
      <h2 id="output-heading">Run status</h2>
      <strong>No runs yet.</strong>
      <p class="subtle">Add prompts and target businesses, then start a batch. Scrape Active Tab is still useful for selector checks.</p>
    `;
    return;
  }

  const s = summary(current);
  const currentLabel = current.current
    ? `${ENGINE_LABELS[current.current.engine] || current.current.engine}: ${current.current.prompt}`
    : current.status;
  const engineMetrics = Object.entries(s.byEngine).map(([engine, item]) =>
    `<span class="metric">${esc(ENGINE_LABELS[engine] || engine)} <b>${percent(item.mentioned, item.eligible)}</b> <small>${item.mentioned}/${item.eligible} eligible target checks · ${item.unavailable} unavailable · ${item.failure} failed</small></span>`
  ).join("");
  const businessMetrics = Object.entries(s.byBusiness).map(([business, item]) =>
    `<span class="metric">${esc(business)} <b>${percent(item.mentioned, item.eligible)}</b> <small>${item.mentioned}/${item.eligible} eligible answers · ${item.unavailable} unavailable · ${item.failure} failed</small></span>`
  ).join("");

  const results = (current.results || []).slice(-8).reverse().map((result) => {
    const classification = result.classification || classifyResult(result);
    const matches = (result.matches || []).map((match) => {
      const cls = match.mentioned ? "ok" : "warn";
      const bits = [
        (match.inText ?? match.inAnswer) ? "text" : "",
        match.inThinking ? "thinking" : "",
        match.inSources ? "sources" : "",
      ].filter(Boolean).join(" + ") || "not found";
      const snippet = (match.snippets || [])[0];
      return `<span class="badge ${cls}">${esc(match.business)}: ${esc(bits)}</span>${
        snippet ? `<pre>${esc(snippet.snippet)}</pre>` : ""
      }`;
    }).join("<br />");
    return `
      <div class="result">
        <div class="result-title">
          <span>${esc(ENGINE_LABELS[result.engine] || result.engine)}</span>
          <span class="badge ${classification.kind === "success" ? "ok" : classification.kind === "failure" ? "fail" : "warn"}">${esc(result.status)} · ${esc(classification.kind)}</span>
        </div>
        <p class="subtle">${esc(result.prompt || "")}</p>
        <div>${matches || '<span class="subtle">No targets configured.</span>'}</div>
      </div>
    `;
  }).join("");

  const errors = (current.errors || []).slice(-4).map((err) =>
    `<div class="result"><span class="badge fail">${esc(ENGINE_LABELS[err.engine] || err.engine)}</span> ${esc(err.prompt)}<pre>${esc(err.error)}</pre></div>`
  ).join("");
  const failedCount = Math.max(current.failed || 0, s.counts.failure, (current.errors || []).length);

  output.innerHTML = `
    <h2 id="output-heading">Run status</h2>
    <div class="row">
      <span class="badge ${current.status === "complete" ? "ok" : current.status === "running" ? "" : "warn"}">${esc(current.status)}</span>
      <span class="subtle">${esc(currentLabel)}</span>
    </div>
    <progress max="${Math.max(current.total || 0, 1)}" value="${Math.min(current.completed || 0, Math.max(current.total || 0, 1))}" aria-label="Run progress">${percent(current.completed || 0, current.total || 0)}</progress>
    <div class="row" style="margin-top: 8px">
      <span class="metric">Completed <b>${current.completed || 0}/${current.total || 0}</b></span>
      <span class="metric">Successful answers <b>${s.counts.success}</b></span>
      <span class="metric">Unavailable <b>${s.counts.unavailable}</b></span>
      <span class="metric">Failed <b>${failedCount}</b></span>
      <span class="metric">History <b>${history.length}</b></span>
    </div>
    <p class="subtle field-note">Visibility is mentions divided by eligible, successfully extracted answers. Unavailable answer surfaces and technical failures are excluded and shown separately. N/A means there are no eligible answers.</p>
    ${state.storageNotice && state.storageNotice.pruned
      ? `<p class="subtle">Storage limit reached: ${esc(state.storageNotice.pruned)} older archived run(s) were pruned.</p>`
      : ""}
    <h2>Visibility By Engine</h2>
    <div class="row">${engineMetrics || '<span class="subtle">No completed rows yet.</span>'}</div>
    <h2>Visibility By Business</h2>
    <div class="row">${businessMetrics || '<span class="subtle">No completed rows yet.</span>'}</div>
    <h2>Latest Results</h2>
    ${results || '<p class="subtle">Waiting for the first result.</p>'}
    ${errors ? `<h2>Recent Errors</h2>${errors}` : ""}
  `;
  announce(`${current.status}. ${current.completed || 0} of ${current.total || 0} completed. ${s.counts.success} successful, ${s.counts.unavailable} unavailable, ${failedCount} failed.`);
}

export function csvEscape(value) {
  let s = String(value ?? "");
  // Scraped page text lands in these cells; neutralize spreadsheet formula
  // injection after leading whitespace or control/format characters before a
  // spreadsheet application ever sees it. Plain negative numbers stay numeric.
  if (/^[\p{White_Space}\p{Cc}\p{Cf}]*[=+@-]/u.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function booleanCell(value) {
  return typeof value === "boolean" ? yesNo(value) : "";
}

function resultExportRows(run) {
  const rows = [];
  for (const result of run?.results || []) {
    const classification = result.classification || classifyResult(result);
    const matches = result.matches?.length ? result.matches : [null];
    for (const match of matches) rows.push({ result, match, classification, error: "" });
  }
  for (const error of run?.errors || []) {
    rows.push({
      result: {
        prompt: error.prompt || "",
        engine: error.engine || "",
        status: error.reason || "error",
        timestamp: error.timestamp || "",
      },
      match: null,
      classification: { kind: "failure", eligible: false, reason: error.reason || "error" },
      error: error.error || "Unknown error",
    });
  }
  return rows;
}

export function buildCsv(run) {
  const headers = [
    "run_id",
    "prompt",
    "engine",
    "business",
    "mentioned",
    "in_text",
    "in_answer",
    "in_thinking",
    "in_sources",
    "snippet",
    "source_domains",
    "status",
    "classification",
    "classification_reason",
    "visibility_eligible",
    "error",
    "answer_chars",
    "answer_text",
    "thinking_chars",
    "thinking_text",
    "url",
    "source_urls",
    "source_texts",
    "timestamp",
  ];
  const lines = [headers.join(",")];
  for (const { result, match, classification, error } of resultExportRows(run)) {
    const domains = (result.sources || []).map((s) => s.domain).filter(Boolean).join("; ");
    const sourceUrls = (result.sources || []).map((s) => s.url).filter(Boolean).join("; ");
    const sourceTexts = (result.sources || [])
      .map((s) => [s.domain, s.text].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" | ");
    const firstSnippet = (match?.snippets || [])[0];
    lines.push([
      run.id,
      result.prompt,
      result.engine,
      match?.business || "",
      booleanCell(match?.mentioned),
      booleanCell(match ? (match.inText ?? match.inAnswer) : undefined),
      booleanCell(match?.inAnswer),
      booleanCell(match?.inThinking),
      booleanCell(match?.inSources),
      firstSnippet ? firstSnippet.snippet : "",
      domains,
      result.status,
      classification.kind,
      classification.reason,
      yesNo(classification.eligible),
      error,
      (result.answerText || "").length,
      result.answerText || "",
      (result.thinkingText || "").length,
      result.thinkingText || "",
      result.url,
      sourceUrls,
      sourceTexts,
      result.timestamp,
    ].map(csvEscape).join(","));
  }
  // UTF-8 BOM + CRLF so Excel opens the file with correct encoding and rows.
  return "\ufeff" + lines.join("\r\n");
}

export function buildReport(run) {
  const s = summary(run);
  const failedCount = Math.max(run?.failed || 0, s.counts.failure, (run?.errors || []).length);
  const engineRows = Object.entries(s.byEngine).map(([engine, item]) =>
    `<tr><td>${esc(ENGINE_LABELS[engine] || engine)}</td><td>${item.mentioned}</td><td>${item.eligible}</td><td>${item.unavailable}</td><td>${item.failure}</td><td>${percent(item.mentioned, item.eligible)}</td></tr>`
  ).join("");
  const businessRows = Object.entries(s.byBusiness).map(([business, item]) =>
    `<tr><td>${esc(business)}</td><td>${item.mentioned}</td><td>${item.eligible}</td><td>${item.unavailable}</td><td>${item.failure}</td><td>${percent(item.mentioned, item.eligible)}</td></tr>`
  ).join("");
  const detailRows = resultExportRows(run).filter((row) => !row.error).map(({ result, match, classification }) => {
    const firstSnippet = (match?.snippets || [])[0];
    return `<tr>
      <td>${esc(result.prompt)}</td>
      <td>${esc(ENGINE_LABELS[result.engine] || result.engine)}</td>
      <td>${esc(result.status)}</td>
      <td>${esc(classification.kind)}</td>
      <td>${yesNo(classification.eligible)}</td>
      <td>${esc(match?.business || "")}</td>
      <td>${booleanCell(match?.mentioned)}</td>
      <td>${booleanCell(match ? (match.inText ?? match.inAnswer) : undefined)}</td>
      <td>${booleanCell(match?.inThinking)}</td>
      <td>${booleanCell(match?.inSources)}</td>
      <td>${esc(firstSnippet ? firstSnippet.snippet : "")}</td>
    </tr>`;
  }).join("");
  const errorRows = (run?.errors || []).map((error) => `<tr>
    <td>${esc(error.prompt || "")}</td>
    <td>${esc(ENGINE_LABELS[error.engine] || error.engine || "")}</td>
    <td>${esc(error.reason || "error")}</td>
    <td>${esc(error.error || "Unknown error")}</td>
    <td>${esc(error.timestamp || "")}</td>
  </tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
  <title>GEO Visibility Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; color: #172033; overflow-wrap: anywhere; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0 28px; }
    th, td { border: 1px solid #d8dde6; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f2f4f7; }
    .meta { color: #667085; }
    @media (max-width: 720px) { body { margin: 16px; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <h1>GEO Visibility Report</h1>
  <p class="meta">Run ${esc(run.id)}. Started ${esc(run.startedAt || "")}. Finished ${esc(run.finishedAt || run.updatedAt || "")}.</p>
  <p class="meta">Visibility is mentions divided by eligible, successfully extracted answers. Unavailable answer surfaces and technical failures are excluded and shown separately. N/A means there are no eligible answers.</p>
  <h2>Result Validity</h2>
  <table><thead><tr><th>Successful answers</th><th>Unavailable surfaces</th><th>Failures</th></tr></thead><tbody><tr><td>${s.counts.success}</td><td>${s.counts.unavailable}</td><td>${failedCount}</td></tr></tbody></table>
  <h2>Visibility By Engine</h2>
  <table><thead><tr><th>Engine</th><th>Mentions</th><th>Eligible</th><th>Unavailable</th><th>Failures</th><th>Visibility</th></tr></thead><tbody>${engineRows}</tbody></table>
  <h2>Visibility By Business</h2>
  <table><thead><tr><th>Business</th><th>Mentions</th><th>Eligible</th><th>Unavailable</th><th>Failures</th><th>Visibility</th></tr></thead><tbody>${businessRows}</tbody></table>
  <h2>Prompt Details</h2>
  <table><thead><tr><th>Prompt</th><th>Engine</th><th>Status</th><th>Validity</th><th>Eligible</th><th>Business</th><th>Mentioned</th><th>Text</th><th>Thinking</th><th>Sources</th><th>Snippet</th></tr></thead><tbody>${detailRows}</tbody></table>
  ${errorRows ? `<h2>Failures</h2><table><thead><tr><th>Prompt</th><th>Engine</th><th>Status</th><th>Error</th><th>Timestamp</th></tr></thead><tbody>${errorRows}</tbody></table>` : ""}
</body>
</html>`;
}

function downloadFile(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportApproved(kind) {
  return confirm(
    `${kind} can contain full prompts, scraped answer/reasoning text, snippets, and source URLs. ` +
    "Review it before sharing. Continue with the download?"
  );
}

function safeFilenamePart(value) {
  return String(value || "run").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || "run";
}

async function refresh() {
  const response = await message("GET_GEO_STATE");
  state = {
    run: response.run,
    history: response.history || [],
    settings: response.settings,
    storageNotice: response.storageNotice || null,
  };
  restoreSettings(state.settings);
  render();
}

function initPopup() {
  startBtn.addEventListener("click", async () => {
    if (!validateForm({ requireTargets: true, requireEngines: true })) return;
    startBtn.disabled = true;
    try {
      if (configFromForm().googleSearch.device === "mobile") {
        const granted = await requestGoogleMobilePermission();
        if (!granted) {
          throw new Error("Mobile Google search needs the Chrome debugger permission. Select Desktop or allow the permission.");
        }
      }
      await message("START_BATCH_RUN", { config: configFromForm() });
      announce("Batch run started.");
      await refresh();
    } catch (error) {
      showGeneralError(error);
      startBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener("click", async () => {
    cancelBtn.disabled = true;
    try {
      await message("CANCEL_BATCH_RUN");
      announce("Cancellation requested.");
      await refresh();
    } catch (error) {
      showGeneralError(error);
      cancelBtn.disabled = false;
    }
  });

  scrapeBtn.addEventListener("click", async () => {
    scrapeBtn.disabled = true;
    try {
      const response = await message("SCRAPE_ACTIVE_TAB");
      const json = esc(JSON.stringify(response.result, null, 2));
      showManualFeedback("ok", "Active tab scraped", response.selectedTab, `<pre>${json}</pre>`);
    } catch (error) {
      showGeneralError(error);
    } finally {
      scrapeBtn.disabled = false;
    }
  });

  runActiveBtn.addEventListener("click", async () => {
    if (!validateForm({ requireTargets: false, requireEngines: false })) return;
    runActiveBtn.disabled = true;
    try {
      if (configFromForm().googleSearch.device === "mobile") {
        const granted = await requestGoogleMobilePermission();
        if (!granted) {
          throw new Error("Mobile Google search needs the Chrome debugger permission. Select Desktop or allow the permission.");
        }
      }
      const firstPrompt = parsePrompts(promptsEl.value)[0];
      const response = await message("RUN_PROMPT_ACTIVE_TAB", { prompt: firstPrompt, config: configFromForm() });
      showManualFeedback("ok", "Active-tab run started", response.selectedTab, "<p class=\"subtle\">Progress appears in Run status below.</p>");
      await refresh();
    } catch (error) {
      showGeneralError(error);
      runActiveBtn.disabled = false;
    }
  });

  csvBtn.addEventListener("click", () => {
    const run = activeRun();
    if (!run || !exportApproved("CSV exports")) return;
    downloadFile(`geo-results-${safeFilenamePart(run.id)}.csv`, "text/csv;charset=utf-8", buildCsv(run));
    announce("CSV export downloaded. Review it before sharing.");
  });

  reportBtn.addEventListener("click", () => {
    const run = activeRun();
    if (!run || !exportApproved("HTML reports")) return;
    downloadFile(`geo-report-${safeFilenamePart(run.id)}.html`, "text/html;charset=utf-8", buildReport(run));
    announce("HTML report downloaded. Review it before sharing.");
  });

  clearHistoryBtn.addEventListener("click", async () => {
    const count = (state.history || []).length;
    if (!confirm(`Permanently delete ${count} archived ${count === 1 ? "run" : "runs"}? Current run and settings will remain. This cannot be undone.`)) return;
    try {
      await message("CLEAR_GEO_HISTORY");
      await refresh();
      announce("Archived run history cleared. Current run and settings were kept.");
    } catch (error) {
      showGeneralError(error);
    }
  });

  resetBtn.addEventListener("click", async () => {
    const confirmed = confirm(
      "Permanently clear prompts, targets, settings, the current run, and all archived history, then reload the extension? This cannot be undone."
    );
    if (!confirmed) return;
    resetting = true;
    clearTimeout(saveTimer);
    try {
      await message("RESET_EXTENSION_DATA");
      state = { run: null, history: [], settings: null, storageNotice: null };
      promptsEl.value = "";
      targetsEl.value = "";
      throttleEl.value = 3000;
      retriesEl.value = 1;
      googleCountryEl.value = "";
      googleLanguageEl.value = "";
      googleLocationEl.value = "";
      googleDeviceEl.value = "desktop";
      setSelectedEngines(Object.keys(ENGINE_LABELS));
      updateGoogleSearchPreview();
      output.innerHTML = "<h2 id=\"output-heading\">Run status</h2><span class=\"badge ok\">Data cleared</span><p class=\"subtle\">Reloading the extension…</p>";
      announce("All extension data cleared. Reloading.");
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      resetting = false;
      showGeneralError(error);
    }
  });

  [promptsEl, targetsEl, throttleEl, retriesEl, googleCountryEl, googleLanguageEl, googleLocationEl].forEach((el) => {
    el.addEventListener("input", () => {
      clearFieldError(el.id);
      clearGeneralError();
      updateGoogleSearchPreview();
      queueSettingsSave();
    });
  });

  googleDeviceEl.addEventListener("change", async () => {
    if (googleDeviceEl.value === "mobile") {
      try {
        const granted = await requestGoogleMobilePermission();
        if (!granted) {
          googleDeviceEl.value = "desktop";
          updateGoogleSearchPreview();
          showGeneralError(new Error("Mobile Google search needs the Chrome debugger permission. Desktop mode remains available."));
          return;
        }
      } catch (error) {
        googleDeviceEl.value = "desktop";
        updateGoogleSearchPreview();
        showGeneralError(error);
        return;
      }
    }
    clearGeneralError();
    updateGoogleSearchPreview();
    queueSettingsSave();
  });

  document.querySelectorAll('input[name="engine"]').forEach((el) => {
    el.addEventListener("change", () => {
      clearFieldError("engines");
      clearGeneralError();
      queueSettingsSave();
    });
  });

  window.addEventListener("beforeunload", () => {
    if (resetting) return;
    chrome.runtime.sendMessage({ type: "SAVE_GEO_SETTINGS", config: configFromForm() });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.geoRun || changes.geoHistory || changes.geoStorageNotice) {
      refresh().catch(showGeneralError);
    }
  });

  refresh().catch(showGeneralError);
}

if (hasDocument && typeof chrome !== "undefined") initPopup();
