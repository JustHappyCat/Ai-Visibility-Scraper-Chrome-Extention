// perplexity.js - scraper and prompt runner for perplexity.ai
// Extracts: answer prose, visible reasoning/steps (Pro/Reasoning modes), and sources.
// Selectors are best-effort and will need maintenance.

(function () {
  const GEO = window.GEO;

  function isVisible(node) {
    if (!node) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    return !style || (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0");
  }

  function isSearchRoute() {
    try {
      return /^\/search(?:\/|$)/i.test(new URL(location.href).pathname);
    } catch (_error) {
      return false;
    }
  }

  function getAnswerRoot() {
    // A generic `.prose` block can be navigation, marketing, or an older turn.
    // Require a Perplexity answer marker or a prose block inside an explicitly
    // marked answer/response container so ambiguous pages fail closed.
    const markedSelectors = [
      '[id^="markdown-content"]',
      '[data-testid*="answer" i] div.prose',
      '[data-testid*="answer" i] [class*="prose"]',
      '[data-testid*="response" i] div.prose',
      '[data-testid*="response" i] [class*="prose"]',
    ];
    const searchRoute = isSearchRoute();
    const selectors = searchRoute
      ? [...markedSelectors, "main .prose", 'main [class*="prose"]']
      : markedSelectors;
    const candidates = GEO.allMatches(document, selectors).filter((el) => {
      const text = GEO.text(el);
      const marked =
        /^markdown-content/i.test(el.id || "") ||
        Boolean(el.closest('[data-testid*="answer" i], [data-testid*="response" i]'));
      // Perplexity no longer consistently exposes answer/test-id markers. Its
      // generated result still lives in a prose block under <main> on a
      // /search/... route. Keep this fallback route- and container-bounded so
      // marketing prose on the home page cannot be mistaken for an answer.
      const boundedSearchProse = searchRoute && Boolean(el.closest("main"));
      return (marked || boundedSearchProse) && isVisible(el) && text.length > 40;
    });
    candidates.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return candidates[candidates.length - 1] || null;
  }

  function getAnswerText(root) {
    return GEO.text(root || getAnswerRoot());
  }

  function getResponseRoot(answerRoot) {
    if (!answerRoot) return null;
    // Never climb to a thread-level ancestor: it may contain private citations
    // and activity from unrelated turns. If no response wrapper is proven, use
    // only the answer node and omit sibling metadata.
    return answerRoot.closest(
      '[data-testid*="answer" i], [data-testid*="response" i]'
    ) || answerRoot;
  }

  function getThinking(answerRoot) {
    // Keep activity/reasoning inside the latest answer context. Searching the
    // full document can accidentally attach an older turn's reasoning.
    const root = getResponseRoot(answerRoot);
    if (!root) return { text: "", debug: { matchedLabels: [], fallback: "no-answer-root" } };

    const labels = ["activity", "thinking", "reasoning", "steps"];
    const labelElements = GEO.allMatches(root, ["button", "summary", "h1", "h2", "h3", "strong", "span"])
      .filter((el) => {
        const text = GEO.text(el).toLowerCase();
        return text.length <= 40 && labels.some((label) => text === label || text.startsWith(label));
      });
    let best = "";
    for (const label of labelElements) {
      let node = label;
      for (let depth = 0; depth < 5 && node && root.contains(node); depth++, node = node.parentElement) {
        const text = GEO.text(node);
        if (text.length > best.length && text.length < 6000) best = text;
        if (node === root) break;
      }
    }
    if (best) {
      return {
        text: best,
        debug: { matchedLabels: labelElements.map((el) => GEO.text(el).toLowerCase()), fallback: "latest-turn-label" },
      };
    }

    const candidates = GEO.allMatches(root, [
      '[class*="reasoning"]',
      '[class*="steps"]',
      '[data-testid*="step"]',
    ]);
    for (const el of candidates) {
      const t = GEO.text(el);
      if (t.length > best.length && t.length < 6000) best = t;
    }
    return { text: best, debug: { matchedLabels: [], fallback: "latest-turn-class" } };
  }

  function getSources(root) {
    // Sources render as citation cards/links pointing to external domains.
    if (!root) return [];
    const anchors = GEO.allMatches(root, ["a[href^='http']"]).filter(
      (a) => !a.href.includes("perplexity.ai")
    );
    return GEO.collectLinks(anchors);
  }

  function scrape() {
    const answerRoot = getAnswerRoot();
    const answerText = getAnswerText(answerRoot);
    const responseRoot = getResponseRoot(answerRoot);
    const thinking = getThinking(answerRoot);
    const thinkingText = thinking.text;
    const sources = getSources(responseRoot || answerRoot);

    return GEO.payload("perplexity", {
      answerText,
      thinkingText,
      sources,
      status: answerText ? "ok" : "no-answer-found",
      debug: {
        foundAnswerRoot: !!answerRoot,
        foundResponseRoot: Boolean(responseRoot && responseRoot !== answerRoot),
        answerChars: answerText.length,
        thinkingChars: thinkingText.length,
        sourceCount: sources.length,
        thinking: thinking.debug,
      },
    });
  }

  function getComposer() {
    const selectors = [
      'textarea[placeholder*="Ask" i]',
      'textarea[aria-label*="Ask" i]',
      '[data-lexical-editor="true"][contenteditable]:not([contenteditable="false"])',
      '[role="textbox"][contenteditable]:not([contenteditable="false"])',
      'textarea',
      '[contenteditable]:not([contenteditable="false"])',
      '[role="textbox"]',
    ];
    for (const selector of selectors) {
      const candidates = GEO.allMatches(document, [selector]).filter((el) => {
        if (!isVisible(el) || el.disabled || el.readOnly) return false;
        return el.getAttribute("aria-disabled") !== "true";
      });
      if (!candidates.length) continue;
      return candidates.find((el) => el.closest("form")) || candidates[0];
    }
    return null;
  }

  function getSubmitButton(composer) {
    const selectors = [
      'button[aria-label*="Submit" i]',
      'button[aria-label*="Send" i]',
      'button[data-testid*="submit" i]',
      'button[type="submit"]',
    ];
    const form = composer && composer.closest("form");
    for (const root of [form, document].filter(Boolean)) {
      const button = GEO.allMatches(root, selectors).find(
        (candidate) => isVisible(candidate) && !candidate.disabled && candidate.getAttribute("aria-disabled") !== "true"
      );
      if (button) return button;
    }
    return null;
  }

  function composerText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return String(el.value || "").trim();
    return GEO.text(el);
  }

  function dispatchTextInput(el, text) {
    const InputEventClass = window.InputEvent || window.Event;
    el.dispatchEvent(new InputEventClass("input", {
      bubbles: true,
      data: text,
      inputType: "insertText",
    }));
  }

  function setComposerText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      dispatchTextInput(el, text);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const selection = window.getSelection && window.getSelection();
    if (selection && document.createRange) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.addRange(range);
    }
    const inserted = document.execCommand && document.execCommand("insertText", false, text);
    if (!inserted || !composerText(el)) el.textContent = text;
    dispatchTextInput(el, text);
  }

  function normalized(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  async function submitPrompt(prompt) {
    const composer = getComposer();
    if (!composer) throw new Error("Visible Perplexity ask composer not found.");
    setComposerText(composer, prompt);
    await GEO.sleep(300);
    if (!normalized(composerText(composer)).includes(normalized(prompt))) {
      throw new Error("Perplexity composer did not accept the prompt text.");
    }

    const button = getSubmitButton(composer);
    if (button) {
      button.click();
      return;
    }

    const form = composer.closest("form");
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return;
    }

    const eventOptions = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
    composer.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
    composer.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
  }

  async function waitForAnswer(previousText) {
    try {
      await GEO.waitFor(() => {
        const text = getAnswerText();
        return text && text !== previousText && text.length > 40;
      }, { timeout: 120000, interval: 1000 });
    } catch (_error) {
      throw new Error(
        "Timed out after 120 seconds waiting for a new Perplexity answer. " +
        "The page may still be generating, or its answer layout may have changed."
      );
    }
    await GEO.sleep(2500);
  }

  async function runPrompt(prompt) {
    if (!prompt) throw new Error("No prompt provided.");
    const previousText = getAnswerText();
    await submitPrompt(prompt);
    await waitForAnswer(previousText);
    const result = scrape();
    if (result.status !== "ok") throw new Error("No new Perplexity answer could be extracted.");
    result.prompt = prompt;
    return result;
  }

  GEO.registerScraper("perplexity", scrape);
  GEO.on("RUN_PROMPT_SYNC", (msg) => runPrompt((msg.prompt || "").trim()));
  GEO.registerRunner((msg) => runPrompt((msg.prompt || "").trim()));
})();
