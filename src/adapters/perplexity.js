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

  function getAnswerRoot() {
    // The answer prose renders in a markdown/prose container.
    const candidates = GEO.allMatches(document, [
      '[id^="markdown-content"]',
      "div.prose",
      '[class*="prose"]',
      'main [class*="answer"]',
    ]).filter((el) => {
      const text = GEO.text(el);
      return isVisible(el) && text.length > 40;
    });
    return candidates[candidates.length - 1] || null;
  }

  function getAnswerText(root) {
    return GEO.text(root || getAnswerRoot());
  }

  function getThinking() {
    // Perplexity labels the reasoning panel "Activity" (and shows "Thinking" steps).
    // Try label-based detection first, then fall back to class-name heuristics.
    const byLabel = GEO.findThinkingByLabel(["activity", "thinking", "reasoning", "steps"]);
    if (byLabel.text) return byLabel;

    const candidates = GEO.allMatches(document, [
      '[class*="reasoning"]',
      '[class*="steps"]',
      '[data-testid*="step"]',
    ]);
    let best = "";
    for (const el of candidates) {
      const t = GEO.text(el);
      if (t.length > best.length) best = t;
    }
    return { text: best, debug: { matchedLabels: [], fallback: "class-name" } };
  }

  function getSources(root) {
    // Sources render as citation cards/links pointing to external domains.
    const anchors = GEO.allMatches(root || document, ["a[href^='http']"]).filter(
      (a) => !a.href.includes("perplexity.ai")
    );
    return GEO.collectLinks(anchors);
  }

  function scrape() {
    const answerRoot = getAnswerRoot();
    const answerText = getAnswerText(answerRoot);
    const thinking = getThinking();
    const thinkingText = thinking.text;
    const sources = getSources(answerRoot || document);

    return GEO.payload("perplexity", {
      answerText,
      thinkingText,
      sources,
      status: answerText ? "ok" : "no-answer-found",
      debug: {
        foundAnswerRoot: !!answerRoot,
        answerChars: answerText.length,
        thinkingChars: thinkingText.length,
        sourceCount: sources.length,
        thinking: thinking.debug,
      },
    });
  }

  function getComposer() {
    return GEO.firstMatch(document, [
      "textarea",
      'div[contenteditable="true"]',
      '[role="textbox"]',
      "main form textarea",
    ]);
  }

  function getSubmitButton() {
    return GEO.firstMatch(document, [
      'button[aria-label*="Submit" i]',
      'button[aria-label*="Send" i]',
      'button[type="submit"]',
    ]);
  }

  function setComposerText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
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
    if (!composer) throw new Error("Perplexity composer not found.");
    setComposerText(composer, prompt);
    await GEO.sleep(300);
    const button = getSubmitButton();
    if (button && !button.disabled) {
      button.click();
    } else {
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
  }

  async function waitForAnswer(previousText) {
    await GEO.waitFor(() => {
      const text = getAnswerText();
      return text && text !== previousText && text.length > 80;
    }, { timeout: 90000, interval: 1000 });
    await GEO.sleep(2500);
  }

  async function runPrompt(prompt) {
    if (!prompt) throw new Error("No prompt provided.");
    const previousText = getAnswerText();
    await submitPrompt(prompt);
    await waitForAnswer(previousText);
    const result = scrape();
    result.prompt = prompt;
    return result;
  }

  GEO.registerScraper("perplexity", scrape);
  GEO.on("RUN_PROMPT_SYNC", (msg) => runPrompt((msg.prompt || "").trim()));
  GEO.registerRunner((msg) => runPrompt((msg.prompt || "").trim()));
})();
