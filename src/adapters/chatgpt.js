// chatgpt.js - scraper and prompt runner for chatgpt.com / chat.openai.com
// Extracts: latest assistant answer, visible "thinking"/reasoning summary, cited sources.
// NOTE: ChatGPT only renders a summarized reasoning trace; that is the most we can capture.
// Selectors are best-effort and WILL need maintenance as the UI changes.

(function () {
  const GEO = window.GEO;

  function getLastAssistantTurn() {
    const assistants = GEO.allMatches(document, [
      '[data-message-author-role="assistant"]',
      'article[data-turn="assistant"]',
      'article[data-testid^="conversation-turn"] [data-message-author-role="assistant"]',
    ]).filter((el) =>
      el.getAttribute("data-message-author-role") === "assistant" ||
      el.getAttribute("data-turn") === "assistant"
    );

    // allMatches groups results by selector rather than document order. Sorting
    // prevents a selector added for an older markup variant from winning.
    assistants.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return assistants[assistants.length - 1] || null;
  }

  function getTurnContainer(assistant) {
    if (!assistant) return null;
    if (assistant.matches('article[data-turn="assistant"], article[data-testid^="conversation-turn"]')) {
      return assistant;
    }
    return assistant.closest(
      'article[data-turn="assistant"], article[data-testid^="conversation-turn"], article'
    ) || assistant;
  }

  function getAnswerText(turn) {
    if (!turn) return "";
    // The rendered markdown body is the cleanest source of answer text.
    const md = GEO.firstMatch(turn, [
      ".markdown",
      '[data-message-author-role="assistant"] .markdown',
      ".prose",
    ]);
    return GEO.text(md || turn);
  }

  function thinkingLabel(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return /^(?:activity|thinking|thought for\b|reasoning|analyzing|searched\b)/i.test(value)
      ? value
      : "";
  }

  function withoutThinkingLabel(text, label) {
    let value = String(text || "").replace(/\s+/g, " ").trim();
    if (label && value.toLowerCase().startsWith(label.toLowerCase())) {
      value = value.slice(label.length).trim();
    }
    return value;
  }

  function getThinking(assistant) {
    // Reasoning is a sibling of the answer inside the assistant article in the
    // current UI. Scoping to that article avoids returning an older turn.
    const root = getTurnContainer(assistant) || document;
    const toggles = GEO.allMatches(root, ["button", '[role="button"]', "summary"])
      .map((el) => ({ el, label: thinkingLabel(GEO.text(el)) }))
      .filter((item) => item.label);

    let best = "";
    let matchedLabel = "";
    for (const item of toggles) {
      let node = item.el;
      // The expanded summary is normally an adjacent child of a small wrapper
      // around the toggle. Never climb into a container that includes the answer.
      for (let i = 0; i < 7 && node && node !== root; i++, node = node.parentElement) {
        if (assistant && node !== assistant && node.contains(assistant)) break;
        const text = withoutThinkingLabel(GEO.text(node), item.label);
        if (text.length > best.length && text.length < 12000) {
          best = text;
          matchedLabel = item.label;
        }
      }
    }
    if (best) {
      return { text: best, debug: { matchedLabels: [matchedLabel], fallback: "turn-toggle" } };
    }

    const candidates = GEO.allMatches(root, [
      '[data-testid*="reasoning"]',
      '[data-testid*="thinking"]',
      'div[class*="reasoning"]',
      "details",
    ]);
    for (const el of candidates) {
      if (assistant && (el === assistant || el.contains(assistant))) continue;
      const label = thinkingLabel(GEO.text(el.querySelector("button, summary")));
      const text = withoutThinkingLabel(GEO.text(el), label);
      if (text.length > best.length && text.length < 12000) best = text;
    }
    return {
      text: best,
      debug: {
        matchedLabels: toggles.map((item) => item.label),
        fallback: "turn-testid/class",
      },
    };
  }

  function citationUrl(anchor) {
    const candidates = [
      anchor.href,
      anchor.getAttribute("href"),
      anchor.getAttribute("data-url"),
      anchor.getAttribute("data-href"),
      anchor.getAttribute("alt"),
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        const url = new URL(candidate, location.href);
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        if (host === "chatgpt.com" || host === "chat.openai.com") {
          for (const key of ["url", "q", "target", "dest", "destination"]) {
            const target = url.searchParams.get(key);
            if (target && /^https?:\/\//i.test(target)) return target;
          }
          continue;
        }
        if (/^https?:$/i.test(url.protocol)) return url.href;
      } catch (e) {
        /* malformed candidate, try the next attribute */
      }
    }
    return "";
  }

  function getSources(turn) {
    const root = getTurnContainer(turn) || turn || document;
    // Do not exclude openai.com: it is a legitimate cited domain. Only ChatGPT's
    // own navigation/redirect URLs are internal, and citationUrl unwraps the latter.
    const anchors = GEO.allMatches(root, [
      '[data-testid="webpage-citation-pill"] a',
      '[data-testid*="citation"] a',
      'a[href^="http"]',
      'a[alt^="http"]',
    ]);
    const proxies = anchors.map((anchor) => ({
      href: citationUrl(anchor),
      innerText: GEO.text(anchor),
      textContent: GEO.text(anchor),
    })).filter((anchor) => anchor.href);
    return GEO.collectLinks(proxies);
  }

  function scrape() {
    const turn = getLastAssistantTurn();
    const answerText = getAnswerText(turn);
    const thinking = getThinking(turn);
    const thinkingText = thinking.text;
    const sources = getSources(turn);

    return GEO.payload("chatgpt", {
      answerText,
      thinkingText,
      sources,
      status: answerText ? "ok" : "no-answer-found",
      debug: {
        foundAssistantTurn: !!turn,
        answerChars: answerText.length,
        thinkingChars: thinkingText.length,
        sourceCount: sources.length,
        thinking: thinking.debug,
      },
    });
  }

  // ---- Automation: submit prompt -> wait -> expand thinking -> scrape ----

  function getComposer() {
    return GEO.firstMatch(document, [
      "#prompt-textarea",
      'div[contenteditable="true"]',
      "textarea",
    ]);
  }

  function getSendButton() {
    return GEO.firstMatch(document, [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
    ]);
  }

  function getStopButton() {
    return GEO.firstMatch(document, [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
    ]);
  }

  function setComposerText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // contenteditable (ProseMirror): execCommand reliably fires React's input path.
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  async function submitPrompt(prompt) {
    const composer = getComposer();
    if (!composer) throw new Error("ChatGPT composer not found.");
    setComposerText(composer, prompt);
    await GEO.sleep(200);
    const btn = getSendButton();
    if (btn && !btn.disabled) {
      btn.click();
    } else {
      // Fallback: press Enter.
      composer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    }
  }

  async function waitForCompletion(previousText) {
    // A fast response may finish before the stop button is observed, so accept
    // either positive start evidence or a changed answer. If neither happens,
    // submission did not produce a usable generation.
    const startEvidence = await GEO.waitFor(() => {
      const answer = getAnswerText(getLastAssistantTurn());
      if (getStopButton()) return "generating";
      if (answer && answer !== previousText) return "answer-changed";
      return "";
    }, { timeout: 20000, interval: 250 }).catch(() => "");
    if (!startEvidence) throw new Error("ChatGPT generation did not start.");

    if (getStopButton()) {
      await GEO.waitFor(() => !getStopButton(), { timeout: 180000, interval: 500 });
    }
    await GEO.waitFor(() => {
      const answer = getAnswerText(getLastAssistantTurn());
      return answer && answer !== previousText;
    }, { timeout: 30000, interval: 500 });
    await GEO.sleep(1000);
  }

  async function waitForAnswerChange(previousText) {
    await GEO.waitFor(() => {
      const text = getAnswerText(getLastAssistantTurn());
      return text && text !== previousText && text.length > 20;
    }, { timeout: 30000, interval: 1000 }).catch(() => {});
  }

  async function expandThinking() {
    // ChatGPT collapses the "Activity / Thinking" panel after finishing; click it open
    // so the reasoning summary is present in the DOM before we scrape.
    const assistant = getLastAssistantTurn();
    const root = getTurnContainer(assistant) || document;
    // If content is already expanded, clicking would collapse it.
    if (getThinking(assistant).text) return 0;
    const toggle = GEO.allMatches(root, ["button", '[role="button"]', "summary"])
      .find((el) => thinkingLabel(GEO.text(el)));
    if (!toggle) return 0;
    try {
      toggle.click();
      await GEO.waitFor(() => getThinking(assistant).text, {
        timeout: 4000,
        interval: 150,
      }).catch(() => {});
      return 1;
    } catch (e) {
      return 0;
    }
  }

  async function scrapeExpanded() {
    // Manual "Scrape Active Tab" requests arrive after ChatGPT has usually
    // collapsed this panel, so they need the same expansion step as automation.
    const expanded = await expandThinking();
    const result = scrape();
    result.debug.expandedPanels = expanded;
    return result;
  }

  async function runPrompt(prompt) {
    if (!prompt) throw new Error("No prompt provided.");
    const previousText = getAnswerText(getLastAssistantTurn());
    await submitPrompt(prompt);
    await waitForCompletion(previousText);
    await waitForAnswerChange(previousText);
    const expanded = await expandThinking();
    const result = scrape();
    if (result.status !== "ok" || !result.answerText || result.answerText === previousText) {
      throw new Error("No new ChatGPT answer detected after submitting the prompt.");
    }
    result.debug.expandedPanels = expanded;
    result.prompt = prompt;
    return result;
  }

  GEO.registerScraper("chatgpt", scrapeExpanded);
  GEO.on("RUN_PROMPT_SYNC", (msg) => runPrompt((msg.prompt || "").trim()));
  GEO.registerRunner((msg) => runPrompt((msg.prompt || "").trim()));
  GEO.on("RUN_PROMPT", (msg) => {
    const prompt = (msg.prompt || "").trim();
    if (!prompt) throw new Error("No prompt provided.");

    GEO.storePending("Running on ChatGPT...");
    runPrompt(prompt)
      .then((result) => GEO.storeResult(result))
      .catch((err) => GEO.storeError(err));

    return {
      __geoSkipAutoStore: true,
      ack: { started: true },
    };
  });
})();
