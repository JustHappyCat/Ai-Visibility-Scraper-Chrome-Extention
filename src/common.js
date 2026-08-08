// common.js - shared helpers injected before each engine adapter.
// Goal: best-effort extraction with rich debug info so we can see
// exactly what each adapter found (or failed to find) on the live DOM.

(function () {
  // Avoid double-injection if the script runs twice.
  if (window.__GEO_COMMON__) return;
  window.__GEO_COMMON__ = true;

  const GEO = (window.GEO = window.GEO || {});

  GEO.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Poll `pred` until it returns truthy or `timeout` elapses.
  GEO.waitFor = function (pred, opts) {
    const { timeout = 30000, interval = 300 } = opts || {};
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        let ok = false;
        try {
          ok = pred();
        } catch (e) {
          /* ignore until timeout */
        }
        if (ok) return resolve(ok);
        if (Date.now() - start > timeout) return reject(new Error("waitFor timeout"));
        setTimeout(tick, interval);
      })();
    });
  };

  // Collapse whitespace and trim. Returns "" for null/empty nodes.
  GEO.text = function (node) {
    if (!node) return "";
    const t = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    return t;
  };

  // Try a list of selectors in order; return the first matching element.
  GEO.firstMatch = function (root, selectors) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (e) {
        /* invalid selector for this DOM, ignore */
      }
    }
    return null;
  };

  // Return ALL elements matching ANY selector in the list (de-duplicated).
  GEO.allMatches = function (root, selectors) {
    const set = new Set();
    for (const sel of selectors) {
      try {
        root.querySelectorAll(sel).forEach((el) => set.add(el));
      } catch (e) {
        /* ignore */
      }
    }
    return [...set];
  };

  // Pull href + visible text from a collection of anchor elements,
  // skipping empty/duplicate/in-page links.
  GEO.collectLinks = function (anchors) {
    const seen = new Set();
    const out = [];
    anchors.forEach((a) => {
      const href = a.href || "";
      if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;
      if (seen.has(href)) return;
      seen.add(href);
      out.push({ url: href, text: GEO.text(a), domain: GEO.domainOf(href) });
    });
    return out;
  };

  GEO.domainOf = function (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  };

  // Find the small "header-like" element(s) whose text matches one of `labels`
  // (exact or prefix, case-insensitive). Returns an array of matched elements.
  GEO.findLabelEls = function (labels) {
    const out = [];
    const all = document.querySelectorAll("*");
    for (const el of all) {
      if (el.children.length > 3) continue; // skip big containers
      const t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!t || t.length > 40) continue;
      if (labels.some((l) => t === l || t.startsWith(l))) out.push(el);
    }
    return out;
  };

  // Find a "thinking/reasoning" panel by its header LABEL text, then return the
  // text of the smallest sensible container that holds more than just the label.
  // Returns { text, debug } so the adapter can surface what it found.
  GEO.findThinkingByLabel = function (labels) {
    const seenLabels = [];
    let best = "";

    for (const el of GEO.findLabelEls(labels)) {
      seenLabels.push((el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase());
      // Walk up to find a container with real content beyond the label,
      // but stop before we swallow the whole page.
      let node = el;
      for (let i = 0; i < 6 && node.parentElement; i++) {
        node = node.parentElement;
        const txt = GEO.text(node);
        if (txt.length > 60 && txt.length < 6000) {
          if (txt.length > best.length) best = txt;
          break;
        }
      }
    }
    return { text: best, debug: { matchedLabels: seenLabels } };
  };

  // Standard payload envelope returned by every adapter.
  GEO.payload = function (engine, fields) {
    return Object.assign(
      {
        engine,
        url: location.href,
        timestamp: new Date().toISOString(),
        answerText: "",
        thinkingText: "",
        sources: [],
        status: "ok",
        debug: {},
      },
      fields
    );
  };

  GEO.storeLast = function (entry) {
    const maybePromise = chrome.storage.local.set({ geoLast: entry });
    return maybePromise && typeof maybePromise.then === "function"
      ? maybePromise
      : Promise.resolve();
  };

  GEO.storeResult = function (result) {
    return GEO.storeLast({ ok: true, result, ts: Date.now() });
  };

  GEO.storePending = function (message) {
    return GEO.storeLast({ ok: true, pending: true, message, ts: Date.now() });
  };

  GEO.storeError = function (err) {
    const error = String((err && err.message) || err);
    return GEO.storeLast({ ok: false, error, ts: Date.now() });
  };

  // Generic message routing. Adapters register handlers by message type via GEO.on().
  // A single onMessage listener (added once per page) dispatches to them.
  GEO.handlers = GEO.handlers || {};
  GEO.jobs = GEO.jobs || {};
  GEO.on = function (type, fn) {
    GEO.handlers[type] = fn;
  };

  GEO.registerRunner = function (runFn) {
    GEO.on("RUN_PROMPT_START", (msg) => {
      const jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      GEO.jobs[jobId] = { status: "running", startedAt: new Date().toISOString() };
      Promise.resolve()
        .then(() => runFn(msg))
        .then((result) => {
          GEO.jobs[jobId] = {
            status: "complete",
            result,
            finishedAt: new Date().toISOString(),
          };
          return GEO.storeResult(result);
        })
        .catch((err) => {
          GEO.jobs[jobId] = {
            status: "error",
            error: String((err && err.message) || err),
            finishedAt: new Date().toISOString(),
          };
          return GEO.storeError(err);
        });
      // Skip auto-store: the job handle is not a scrape result, and storing it
      // would overwrite the real last result in geoLast.
      return { __geoSkipAutoStore: true, ack: { result: { jobId, status: "running" } } };
    });

    GEO.on("RUN_PROMPT_STATUS", (msg) => {
      const job = GEO.jobs[msg.jobId];
      const result = job || { status: "error", error: "Prompt job not found." };
      // Skip auto-store: this fires ~1/sec while polling and must not clobber
      // geoLast with transient job-status snapshots.
      return { __geoSkipAutoStore: true, ack: { result } };
    });
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    const fn = GEO.handlers[msg.type];
    if (!fn) return;
    Promise.resolve()
      .then(() => fn(msg))
      .then((result) => {
        if (result && result.__geoSkipAutoStore) {
          const ack = Object.assign({}, result.ack || {});
          sendResponse(Object.assign({ ok: true }, ack));
          return;
        }
        // Persist so the result survives the popup closing / being reopened.
        GEO.storeResult(result);
        sendResponse({ ok: true, result });
      })
      .catch((err) => {
        const error = String((err && err.message) || err);
        GEO.storeError(error);
        sendResponse({ ok: false, error });
      });
    return true; // keep the channel open for the async response
  });

  // Convenience: register a SCRAPE handler.
  GEO.registerScraper = function (engine, scrapeFn) {
    GEO.on("SCRAPE", scrapeFn);
    console.log(`[GEO] ${engine} adapter ready on ${location.href}`);
  };
})();
