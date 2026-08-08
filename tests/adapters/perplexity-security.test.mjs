import assert from "node:assert/strict";
import test from "node:test";

import { loadAdapter, scrapeAdapter } from "../helpers/adapter-harness.mjs";

function element(text, overrides = {}) {
  return {
    id: "",
    innerText: text,
    textContent: text,
    parentElement: null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: (node) => node === this,
    getAttribute: () => null,
    ...overrides,
  };
}

test("generic Perplexity prose fails closed without an answer marker", async () => {
  const generic = element("Generic marketing prose that is intentionally longer than forty characters and is not an answer.");
  const document = {
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === "div.prose" || selector === '[class*="prose"]' ? [generic] : [];
    },
  };

  const result = await scrapeAdapter("perplexity", {
    document,
    location: { href: "https://www.perplexity.ai/" },
  });
  assert.equal(result.status, "no-answer-found");
  assert.equal(result.answerText, "");
  assert.equal(result.sources.length, 0);
});

test("search-route prose inside main is accepted without legacy answer markers", async () => {
  const main = element("Search result");
  const answer = element(
    "A newly rendered fictional Perplexity answer that is long enough for safe extraction.",
    {
      closest(selector) {
        return selector === "main" ? main : null;
      },
    }
  );
  const document = {
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === "main .prose" || selector === 'main [class*="prose"]' ? [answer] : [];
    },
  };

  const result = await scrapeAdapter("perplexity", {
    document,
    location: { href: "https://www.perplexity.ai/search/synthetic-current-layout" },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.answerText, answer.innerText);
  assert.equal(result.sources.length, 0);
});

test("prompt runner selects the visible composer, inserts text, and submits", async () => {
  class SyntheticEvent {
    constructor(type, options = {}) {
      this.type = type;
      Object.assign(this, options);
    }
  }

  class SyntheticTextArea {
    constructor() {
      this.tagName = "TEXTAREA";
      this.disabled = false;
      this.readOnly = false;
      this.events = [];
      this.hidden = false;
      this._value = "";
    }

    focus() {
      this.focused = true;
    }

    dispatchEvent(event) {
      this.events.push(event);
      return true;
    }

    getAttribute() {
      return null;
    }
  }
  Object.defineProperty(SyntheticTextArea.prototype, "value", {
    get() {
      return this._value;
    },
    set(value) {
      this._value = value;
    },
  });

  const prompt = "Which fictional CRM is best for a small team?";
  const location = { href: "https://www.perplexity.ai/" };
  let submitted = false;
  const button = element("Submit", {
    disabled: false,
    click() {
      submitted = true;
      location.href = "https://www.perplexity.ai/search/synthetic-submission";
    },
  });
  const form = element("Ask form", {
    querySelectorAll(selector) {
      return selector === 'button[aria-label*="Submit" i]' ? [button] : [];
    },
  });
  const hiddenComposer = new SyntheticTextArea();
  hiddenComposer.hidden = true;
  hiddenComposer.closest = () => null;
  const composer = new SyntheticTextArea();
  composer.closest = (selector) => selector === "form" ? form : null;
  const answer = element(
    "A fictional submitted response with enough rendered text to satisfy the answer extractor.",
    { id: "markdown-content-current" }
  );
  const document = {
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === 'textarea[placeholder*="Ask" i]') return [hiddenComposer, composer];
      if (selector === '[id^="markdown-content"]' && submitted) return [answer];
      return [];
    },
  };

  const harness = await loadAdapter("perplexity", {
    document,
    location,
    Event: SyntheticEvent,
    InputEvent: SyntheticEvent,
    KeyboardEvent: SyntheticEvent,
    HTMLTextAreaElement: SyntheticTextArea,
    HTMLInputElement: class SyntheticInput {},
    getComputedStyle(node) {
      return { display: node.hidden ? "none" : "block", visibility: "visible", opacity: "1" };
    },
  });
  harness.context.GEO.sleep = () => Promise.resolve();
  harness.context.GEO.waitFor = async (predicate) => {
    assert.equal(Boolean(predicate()), true);
  };

  const result = await harness.context.GEO.handlers.RUN_PROMPT_SYNC({ prompt });
  assert.equal(hiddenComposer.value, "");
  assert.equal(composer.value, prompt);
  assert.equal(composer.focused, true);
  assert.equal(submitted, true);
  assert.equal(result.status, "ok");
});

test("thread-level citations are not attached to a marked answer", async () => {
  const externalLink = element("Older private citation", {
    href: "https://older.example.test/private",
  });
  const thread = element("Older turn plus current turn", {
    querySelectorAll(selector) {
      return selector === "a[href^='http']" ? [externalLink] : [];
    },
  });
  const answer = element("A newly generated fictional response with enough text to be considered a valid marked answer.", {
    id: "markdown-content-current",
    closest(selector) {
      return selector.includes("thread") ? thread : null;
    },
  });
  const document = {
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === '[id^="markdown-content"]' ? [answer] : [];
    },
  };

  const result = await scrapeAdapter("perplexity", {
    document,
    location: { href: "https://www.perplexity.ai/search/synthetic" },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.answerText, answer.innerText);
  assert.equal(result.sources.length, 0);
});
