// popup.js - Phase 6 control surface: batch run, history, CSV, and report export.

const ENGINE_LABELS = {
  chatgpt: "ChatGPT",
  "google-aio": "Google AI Overview",
  perplexity: "Perplexity",
};

const promptsEl = document.getElementById("prompts");
const targetsEl = document.getElementById("targets");
const throttleEl = document.getElementById("throttle");
const retriesEl = document.getElementById("retries");
const output = document.getElementById("output");
const startBtn = document.getElementById("startBtn");
const cancelBtn = document.getElementById("cancelBtn");
const scrapeBtn = document.getElementById("scrapeBtn");
const runActiveBtn = document.getElementById("runActiveBtn");
const csvBtn = document.getElementById("csvBtn");
const reportBtn = document.getElementById("reportBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const resetBtn = document.getElementById("resetBtn");

let state = { run: null, history: [], settings: null };
let restoredSettings = false;
let saveTimer = null;
let resetting = false;

function esc(s) {
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

function configFromForm() {
  return {
    prompts: promptsEl.value,
    targets: targetsEl.value,
    engines: selectedEngines(),
    throttleMs: Number(throttleEl.value || 0),
    retries: Number(retriesEl.value || 0),
  };
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
  setSelectedEngines(settings.engines || Object.keys(ENGINE_LABELS));
  restoredSettings = true;
}

function activeRun() {
  return state.run || (state.history && state.history[0]) || null;
}

function allRows(run) {
  if (!run) return [];
  const rows = [];
  for (const result of run.results || []) {
    for (const match of result.matches || []) {
      rows.push({ result, match });
    }
  }
  return rows;
}

function summary(run) {
  const rows = allRows(run);
  const byEngine = {};
  const byBusiness = {};
  for (const { result, match } of rows) {
    byEngine[result.engine] ||= { total: 0, mentioned: 0 };
    byBusiness[match.business] ||= { total: 0, mentioned: 0 };
    byEngine[result.engine].total += 1;
    byBusiness[match.business].total += 1;
    if (match.mentioned) {
      byEngine[result.engine].mentioned += 1;
      byBusiness[match.business].mentioned += 1;
    }
  }
  return { rows, byEngine, byBusiness };
}

function percent(part, total) {
  return total ? `${Math.round((part / total) * 100)}%` : "0%";
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function render() {
  const run = state.run;
  const history = state.history || [];
  const current = activeRun();
  csvBtn.disabled = !current || !(current.results || []).length;
  reportBtn.disabled = csvBtn.disabled;
  cancelBtn.disabled = !run || run.status !== "running";

  if (!current) {
    output.innerHTML = `
      <strong>No runs yet.</strong>
      <p class="subtle">Add prompts and target businesses, then start a batch. Scrape Active Tab is still useful for selector checks.</p>
    `;
    return;
  }

  const s = summary(current);
  const progressValue = current.total ? current.completed / current.total : 0;
  const currentLabel = current.current
    ? `${ENGINE_LABELS[current.current.engine] || current.current.engine}: ${current.current.prompt}`
    : current.status;
  const engineMetrics = Object.entries(s.byEngine).map(([engine, item]) =>
    `<span class="metric">${esc(ENGINE_LABELS[engine] || engine)} <b>${percent(item.mentioned, item.total)}</b></span>`
  ).join("");
  const businessMetrics = Object.entries(s.byBusiness).map(([business, item]) =>
    `<span class="metric">${esc(business)} <b>${percent(item.mentioned, item.total)}</b></span>`
  ).join("");

  const results = (current.results || []).slice(-8).reverse().map((result) => {
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
          <span class="badge ${result.status === "ok" ? "ok" : "warn"}">${esc(result.status)}</span>
        </div>
        <p class="subtle">${esc(result.prompt || "")}</p>
        <div>${matches || '<span class="subtle">No targets configured.</span>'}</div>
      </div>
    `;
  }).join("");

  const errors = (current.errors || []).slice(-4).map((err) =>
    `<div class="result"><span class="badge fail">${esc(ENGINE_LABELS[err.engine] || err.engine)}</span> ${esc(err.prompt)}<pre>${esc(err.error)}</pre></div>`
  ).join("");

  output.innerHTML = `
    <div class="row">
      <span class="badge ${current.status === "complete" ? "ok" : current.status === "running" ? "" : "warn"}">${esc(current.status)}</span>
      <span class="subtle">${esc(currentLabel)}</span>
    </div>
    <progress max="1" value="${progressValue}"></progress>
    <div class="row" style="margin-top: 8px">
      <span class="metric">Completed <b>${current.completed || 0}/${current.total || 0}</b></span>
      <span class="metric">Failures <b>${current.failed || 0}</b></span>
      <span class="metric">History <b>${history.length}</b></span>
    </div>
    <h2>Visibility By Engine</h2>
    <div class="row">${engineMetrics || '<span class="subtle">No completed rows yet.</span>'}</div>
    <h2>Visibility By Business</h2>
    <div class="row">${businessMetrics || '<span class="subtle">No completed rows yet.</span>'}</div>
    <h2>Latest Results</h2>
    ${results || '<p class="subtle">Waiting for the first result.</p>'}
    ${errors ? `<h2>Recent Errors</h2>${errors}` : ""}
  `;
}

function csvEscape(value) {
  let s = String(value ?? "");
  // Scraped page text lands in these cells; neutralize spreadsheet formula
  // injection ("=", "+", "-", "@" prefixes) before Excel ever sees it.
  if (/^[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(run) {
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
  for (const { result, match } of allRows(run)) {
    const domains = (result.sources || []).map((s) => s.domain).filter(Boolean).join("; ");
    const sourceUrls = (result.sources || []).map((s) => s.url).filter(Boolean).join("; ");
    const sourceTexts = (result.sources || [])
      .map((s) => [s.domain, s.text].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" | ");
    const firstSnippet = (match.snippets || [])[0];
    lines.push([
      run.id,
      result.prompt,
      result.engine,
      match.business,
      yesNo(match.mentioned),
      yesNo(match.inText ?? match.inAnswer),
      yesNo(match.inAnswer),
      yesNo(match.inThinking),
      yesNo(match.inSources),
      firstSnippet ? firstSnippet.snippet : "",
      domains,
      result.status,
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

function buildReport(run) {
  const s = summary(run);
  const engineRows = Object.entries(s.byEngine).map(([engine, item]) =>
    `<tr><td>${esc(ENGINE_LABELS[engine] || engine)}</td><td>${item.mentioned}</td><td>${item.total}</td><td>${percent(item.mentioned, item.total)}</td></tr>`
  ).join("");
  const businessRows = Object.entries(s.byBusiness).map(([business, item]) =>
    `<tr><td>${esc(business)}</td><td>${item.mentioned}</td><td>${item.total}</td><td>${percent(item.mentioned, item.total)}</td></tr>`
  ).join("");
  const detailRows = allRows(run).map(({ result, match }) => {
    const firstSnippet = (match.snippets || [])[0];
    return `<tr>
      <td>${esc(result.prompt)}</td>
      <td>${esc(ENGINE_LABELS[result.engine] || result.engine)}</td>
      <td>${esc(match.business)}</td>
      <td>${yesNo(match.mentioned)}</td>
      <td>${yesNo(match.inText ?? match.inAnswer)}</td>
      <td>${yesNo(match.inThinking)}</td>
      <td>${yesNo(match.inSources)}</td>
      <td>${esc(firstSnippet ? firstSnippet.snippet : "")}</td>
    </tr>`;
  }).join("");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>GEO Visibility Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; color: #172033; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0 28px; }
    th, td { border: 1px solid #d8dde6; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f2f4f7; }
    .meta { color: #667085; }
  </style>
</head>
<body>
  <h1>GEO Visibility Report</h1>
  <p class="meta">Run ${esc(run.id)}. Started ${esc(run.startedAt || "")}. Finished ${esc(run.finishedAt || run.updatedAt || "")}.</p>
  <h2>Visibility By Engine</h2>
  <table><thead><tr><th>Engine</th><th>Mentions</th><th>Rows</th><th>Visibility</th></tr></thead><tbody>${engineRows}</tbody></table>
  <h2>Visibility By Business</h2>
  <table><thead><tr><th>Business</th><th>Mentions</th><th>Rows</th><th>Visibility</th></tr></thead><tbody>${businessRows}</tbody></table>
  <h2>Prompt Details</h2>
  <table><thead><tr><th>Prompt</th><th>Engine</th><th>Business</th><th>Mentioned</th><th>Text</th><th>Thinking</th><th>Sources</th><th>Snippet</th></tr></thead><tbody>${detailRows}</tbody></table>
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

async function refresh() {
  const response = await message("GET_GEO_STATE");
  state = { run: response.run, history: response.history || [], settings: response.settings };
  restoreSettings(state.settings);
  render();
}

startBtn.addEventListener("click", async () => {
  try {
    await message("START_BATCH_RUN", { config: configFromForm() });
    await refresh();
  } catch (err) {
    output.innerHTML = `<span class="badge fail">Error</span><pre>${esc(err.message)}</pre>`;
  }
});

cancelBtn.addEventListener("click", async () => {
  try {
    await message("CANCEL_BATCH_RUN");
    await refresh();
  } catch (err) {
    output.innerHTML = `<span class="badge fail">Error</span><pre>${esc(err.message)}</pre>`;
  }
});

scrapeBtn.addEventListener("click", async () => {
  try {
    const response = await message("SCRAPE_ACTIVE_TAB");
    output.innerHTML = `<span class="badge ok">Scraped</span><pre>${esc(JSON.stringify(response.result, null, 2))}</pre>`;
  } catch (err) {
    output.innerHTML = `<span class="badge fail">Error</span><pre>${esc(err.message)}</pre>`;
  }
});

runActiveBtn.addEventListener("click", async () => {
  try {
    const firstPrompt = (promptsEl.value || "").split(/[\n,]+/).map((s) => s.trim()).find(Boolean);
    if (!firstPrompt) throw new Error("Add a prompt first.");
    await message("RUN_PROMPT_ACTIVE_TAB", { prompt: firstPrompt, config: configFromForm() });
    output.innerHTML = `<span class="badge ok">Started</span><p class="subtle">Running in the active tab. Progress will update here.</p>`;
    await refresh();
  } catch (err) {
    output.innerHTML = `<span class="badge fail">Error</span><pre>${esc(err.message)}</pre>`;
  }
});

csvBtn.addEventListener("click", () => {
  const run = activeRun();
  if (!run) return;
  downloadFile(`geo-results-${run.id}.csv`, "text/csv", buildCsv(run));
});

reportBtn.addEventListener("click", () => {
  const run = activeRun();
  if (!run) return;
  downloadFile(`geo-report-${run.id}.html`, "text/html", buildReport(run));
});

clearHistoryBtn.addEventListener("click", async () => {
  try {
    await message("CLEAR_GEO_HISTORY");
    await refresh();
  } catch (err) {
    output.innerHTML = `<span class="badge fail">Error</span><pre>${esc(err.message)}</pre>`;
  }
});

resetBtn.addEventListener("click", async () => {
  const confirmed = confirm("Clear all extension data and reload the extension?");
  if (!confirmed) return;
  resetting = true;
  clearTimeout(saveTimer);
  await message("RESET_EXTENSION_DATA");
  state = { run: null, history: [], settings: null };
  promptsEl.value = "";
  targetsEl.value = "";
  throttleEl.value = 3000;
  retriesEl.value = 1;
  setSelectedEngines(Object.keys(ENGINE_LABELS));
  output.innerHTML = `<span class="badge ok">Resetting</span><p class="subtle">Extension data cleared. Reloading...</p>`;
  setTimeout(() => location.reload(), 500);
});

[promptsEl, targetsEl, throttleEl, retriesEl].forEach((el) => {
  el.addEventListener("input", queueSettingsSave);
});

document.querySelectorAll('input[name="engine"]').forEach((el) => {
  el.addEventListener("change", queueSettingsSave);
});

window.addEventListener("beforeunload", () => {
  if (resetting) return;
  chrome.runtime.sendMessage({ type: "SAVE_GEO_SETTINGS", config: configFromForm() });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.geoRun || changes.geoHistory) refresh().catch(() => {});
});

refresh().catch((err) => {
  output.innerHTML = `<span class="badge fail">Error</span><pre>${esc(err.message)}</pre>`;
});
