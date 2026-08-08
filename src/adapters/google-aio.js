// google-aio.js - scraper for Google AI Overviews on the SERP.
// Google obfuscates SERP class names, so this adapter scores likely containers
// and cleans UI chrome out of the answer text.
// IMPORTANT: AI Overviews do not appear for every query; "not-present" is valid.

(function () {
  const GEO = window.GEO;

  const UI_TEXT = new Set([
    "ai overview",
    "ai overviews",
    "show more",
    "show less",
    "sources",
    "source",
    "learn more",
    "listen",
    "share",
    "export",
    "feedback",
    "about this result",
    "draft in gmail",
    "google docs",
    "copy",
  ]);

  const FOOTER_TEXT_PATTERNS = [
    /this is for informational purposes only\.?/gi,
    /for medical advice or a diagnosis,?\s*consult a professional\.?/gi,
    /ai responses may include mistakes\.?/gi,
    /draft in gmail/gi,
    /google docs/gi,
  ];

  const ANSWER_SELECTORS = [
    '#m-x-content [data-subtree="aimc"]',
    '#rcnt > div:first-child [data-subtree="aimc"]',
    '[jsname="coFSxe"] [data-subtree="aimc"]',
    '.CKgc1d [data-subtree="aimc"]',
    '[data-subtree="aimc"] [data-container-id="main-col"]',
    '[data-subtree="aimc"] .mZJni.Dn7Fzd',
    '[data-subtree="aimc"] .FkX2oe',
    '[data-subtree="aimc"]',
    '[data-container-id="main-col"]',
    '.mZJni.Dn7Fzd',
    '.FkX2oe',
  ];

  // These markers are intentionally narrower than Google's ordinary result
  // containers. A candidate must contain one of the proven AI Overview markers
  // below; text length, links, and a generic "Show more" control are never
  // sufficient evidence on their own.
  const AIO_ROOT_SELECTORS = [
    '[data-attrid="SGE"]',
    '[data-subtree="mfc"]',
    "#m-x-content",
    '[data-subtree="aimc"]',
    'div[aria-label="AI Overview" i]',
    'div[aria-label="AI Overviews" i]',
    'section[aria-label="AI Overview" i]',
    'section[aria-label="AI Overviews" i]',
  ];

  function rawText(node) {
    return (node && (node.innerText || node.textContent) || "").replace(/\u00a0/g, " ");
  }

  function stripKnownFooterText(text) {
    let cleaned = String(text || "");
    for (const pattern of FOOTER_TEXT_PATTERNS) cleaned = cleaned.replace(pattern, " ");
    return cleaned
      .replace(/\bLearn more\s*(Draft in Gmail|Google Docs)?/gi, " ")
      .replace(/\bDraft in Gmail\s*Google Docs\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isFooterLine(line) {
    const lower = String(line || "").toLowerCase().trim();
    if (!lower) return true;
    if (UI_TEXT.has(lower)) return true;
    if (/^show (more|less)$/i.test(line)) return true;
    if (/^generative ai is experimental/i.test(line)) return true;
    if (/^ai overview/i.test(line) && line.length < 40) return true;
    if (/^this is for informational purposes only/i.test(line)) return true;
    if (/^for medical advice or a diagnosis/i.test(line)) return true;
    if (/^ai responses may include mistakes/i.test(line)) return true;
    if (/^(draft in gmail|google docs|learn more|copy|copied|export)$/i.test(line)) return true;
    return false;
  }

  function cleanAioText(text) {
    const lines = stripKnownFooterText(text)
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((line) => !isFooterLine(line));

    const deduped = [];
    for (const line of lines) {
      if (deduped[deduped.length - 1] !== line) deduped.push(line);
    }

    return stripKnownFooterText(deduped.join(" ")).replace(/\s+/g, " ").trim();
  }

  function textWithoutControls(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll(
      [
        "script",
        "style",
        "svg",
        "g-img",
        "g-dialog",
        "button",
        "[role='button']",
        "[role='dialog']",
        "[data-subtree='dfa']",
        "[data-subtree*='dfa']",
        "[data-subtree='mfl']",
        "[data-subtree*='aimfl']",
        "[data-container-id='rhs-col']",
        "[data-amic]",
        "[data-src-id]",
        "[data-crb-el]",
        ".MFrAxb",
        ".BKnikc",
        ".WBgIic.Wg1cdb",
        ".NMq1me",
        ".S9OuHf",
        ".ofHStc",
        ".h7wxwc",
        ".w6SxZb",
        ".Ztsnxd",
        ".XQLv7d",
        ".F0OfWd",
        ".hfWAgb",
        ".DuQANe",
        ".x2qcTc",
        ".fZavHb",
        "[aria-label='Show more']",
        "[aria-label='Show less']",
      ].join(",")
    ).forEach((el) => {
      if (el.parentNode) el.replaceWith(clone.ownerDocument.createTextNode(" "));
      else el.remove();
    });
    return cleanAioText(rawText(clone));
  }

  function allMatchesIncludingRoot(root, selectors) {
    if (!root) return [];
    const matches = new Set(GEO.allMatches(root, selectors));
    for (const selector of selectors) {
      try {
        if (root.matches && root.matches(selector)) matches.add(root);
      } catch (e) {
        /* Ignore selectors unsupported by the current DOM implementation. */
      }
    }
    return [...matches];
  }

  function bestAnswerCandidate(container) {
    if (!container) return { text: "", selector: "" };
    let best = { text: "", selector: "" };
    for (const selector of ANSWER_SELECTORS) {
      const nodes = allMatchesIncludingRoot(container, [selector]);
      for (const node of nodes) {
        if (isHidden(node)) continue;
        const text = textWithoutControls(node);
        if (isUsefulAnswerText(text) && text.length > best.text.length) {
          best = { text, selector };
        }
      }
    }
    if (best.text) return best;

    const lineGroups = [
      '[jsname="HKDuG"] .EIJn2',
      '[jsname="HKDuG"] .LT6XE',
      '[jsname="HKDuG"] .rPeykc',
      '[jsname="HKDuG"] .zNsLfb',
      '[jsname="HKDuG"] .OfFYCb',
      '#m-x-content [jsname="HKDuG"] .EIJn2',
      '#m-x-content [data-ve-view] .EIJn2',
      '#m-x-content .jloFI .EIJn2',
      '#m-x-content .LT6XE .EIJn2',
      '#m-x-content .rPeykc',
      '#m-x-content .zNsLfb',
      '#m-x-content .OfFYCb',
      '#rcnt > div:first-child [jsname="HKDuG"] .LT6XE',
      '#rcnt > div:first-child #m-x-content .LT6XE',
    ];
    let bestJoined = { text: "", selector: "" };
    for (const selector of lineGroups) {
      const text = joinedNodeText(allMatchesIncludingRoot(container, [selector]));
      if (isUsefulAnswerText(text) && text.length > bestJoined.text.length) {
        bestJoined = { text, selector: `${selector} (joined)` };
      }
    }
    if (bestJoined.text) return bestJoined;

    const selectors = [
      ...ANSWER_SELECTORS,
      '[jsname="HKDuG"] [jsname="g9sGub"]',
      '[jsname="HKDuG"] .jloFI',
      '[jsname="HKDuG"] .LT6XE',
      '[jsname="HKDuG"] .rPeykc',
      '[jsname="HKDuG"] .zNsLfb',
      '[jsname="HKDuG"] .OfFYCb',
      '[jsname="HKDuG"] .EIJn2',
      '.Pqkn2e [jsname="g9sGub"]',
      '.Pqkn2e .jloFI',
      '.LT6XE .EIJn2',
      '.LT6XE',
      '[data-ve-view] .jloFI',
    ];
    for (const selector of selectors) {
      const nodes = allMatchesIncludingRoot(container, [selector]);
      for (const node of nodes) {
        const text = textWithoutControls(node);
        if (isUsefulAnswerText(text) && text.length > best.text.length) {
          best = { text, selector };
        }
      }
    }
    return best;
  }

  function joinedNodeText(nodes) {
    const pieces = [];
    const seen = new Set();
    for (const node of nodes) {
      if (isHidden(node)) continue;
      if (nodes.some((other) => other !== node && other.contains(node))) continue;
      const text = textWithoutControls(node);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      pieces.push(text);
    }
    return cleanAioText(pieces.join(" "));
  }

  function isHidden(node) {
    if (!node) return true;
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return true;
    return node.getAttribute("aria-hidden") === "true";
  }

  function isUsefulAnswerText(text) {
    const clean = cleanAioText(text);
    if (clean.length < 40) return false;
    if (/^show more$/i.test(clean)) return false;
    if (/^ai overview$/i.test(clean)) return false;
    if (/^this is for informational purposes only/i.test(clean)) return false;
    if (/^for medical advice or a diagnosis/i.test(clean)) return false;
    if (/^ai responses may include mistakes/i.test(clean)) return false;
    if (/^(listen|share|feedback|about this result)$/i.test(clean)) return false;
    return /[.!?)]\s|,\s|:\s/.test(clean) || clean.split(/\s+/).length >= 10;
  }

  function findAioLabels(root) {
    const labels = [];
    allMatchesIncludingRoot(root, ["h1, h2, h3, div, span, strong, [aria-label]"]).forEach((el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text === "ai overview" || text === "ai overviews" || aria === "ai overview" || aria === "ai overviews") {
        labels.push(el);
      }
    });
    return labels;
  }

  function evidenceForContainer(el) {
    const evidence = [];
    const has = (selector) => allMatchesIncludingRoot(el, [selector]).length > 0;

    if (has('[data-attrid="SGE"]')) evidence.push("sge-attribute");
    if (has('[data-subtree="aimc"]')) evidence.push("aimc-subtree");
    if (has("#m-x-content")) evidence.push("m-x-content");
    if (
      has(
        'div[aria-label="AI Overview" i], div[aria-label="AI Overviews" i], ' +
          'section[aria-label="AI Overview" i], section[aria-label="AI Overviews" i]'
      )
    ) {
      evidence.push("exact-aria-label");
    }

    const hasMfc = has('[data-subtree="mfc"]');
    const hasExactLabel = findAioLabels(el).length > 0;
    if (hasMfc && hasExactLabel) evidence.push("mfc-with-exact-label");

    return evidence;
  }

  function scoreContainer(el) {
    const evidence = evidenceForContainer(el);
    const text = textWithoutControls(el);
    const answer = bestAnswerCandidate(el);
    const linkCount = el.querySelectorAll("a[href]").length;
    const buttonText = [...el.querySelectorAll("button, [role='button']")]
      .map((button) => cleanAioText(rawText(button)).toLowerCase())
      .filter(Boolean);
    let score = Math.min(text.length, 4000) + answer.text.length * 6 + linkCount * 15;
    if (answer.text.length > 80) score += 1000;
    if (buttonText.includes("show more")) score += 100;
    if (/ai overview/i.test(rawText(el))) score += 50;
    if (text.length > 12000) score -= text.length;
    if (text.toLowerCase() === "show more") score -= 1000;
    return { el, text, answer, score, linkCount, evidence };
  }

  function findAioContainer() {
    const candidates = new Map();
    GEO.allMatches(document, AIO_ROOT_SELECTORS).forEach((el) => candidates.set(el, el));

    const scored = [...candidates.values()]
      .map(scoreContainer)
      .filter((item) => item.evidence.length > 0)
      .sort((a, b) => b.score - a.score);

    return scored[0] || null;
  }

  async function expandAio(container) {
    if (!container) return 0;
    const buttons = GEO.allMatches(container, [
      "button",
      "[role='button']",
      "[aria-label*='Show more' i]",
    ]);
    let clicked = 0;
    for (const button of buttons) {
      const text = rawText(button).replace(/\s+/g, " ").trim().toLowerCase();
      const aria = (button.getAttribute("aria-label") || "").toLowerCase();
      const isAioShowMore =
        text === "show more" || aria === "show more" || (aria.includes("show more") && aria.includes("ai overview"));
      if (isAioShowMore) {
        try {
          button.click();
          clicked++;
        } catch (e) {
          /* ignore */
        }
      }
    }
    if (clicked) await GEO.sleep(1000);
    return clicked;
  }

  function normalizeGoogleHref(href) {
    try {
      const url = new URL(href);
      const q = url.searchParams.get("q") || url.searchParams.get("url");
      if (q && /^https?:\/\//i.test(q)) return q;
      return href;
    } catch (e) {
      return href;
    }
  }

  function getSources(container) {
    const seen = new Set();
    const sources = [];
    GEO.allMatches(container, ["a[href]"]).forEach((a) => {
      const href = normalizeGoogleHref(a.href || "");
      if (!href || !/^https?:\/\//i.test(href)) return;
      const domain = GEO.domainOf(href);
      if (!domain || domain.endsWith("google.com") || domain === "googleusercontent.com") return;
      if (seen.has(href)) return;
      seen.add(href);
      sources.push({
        url: href,
        text: GEO.text(a),
        domain,
      });
    });
    return sources;
  }

  async function scrape() {
    let match = findAioContainer();

    if (!match) {
      return GEO.payload("google-aio", {
        status: "no-ai-overview",
        debug: { note: "No AI Overview block detected for this query." },
      });
    }

    const expandedButtons = await expandAio(match.el);
    if (expandedButtons) match = findAioContainer() || match;

    const answer = bestAnswerCandidate(match.el);
    const answerText = answer.text;
    const sources = getSources(match.el);
    const uiOnly = !isUsefulAnswerText(answerText);

    return GEO.payload("google-aio", {
      answerText: uiOnly ? "" : answerText,
      thinkingText: "", // Google exposes no reasoning trace
      sources,
      status: uiOnly ? "ai-overview-empty" : "ok",
      debug: {
        answerChars: uiOnly ? 0 : answerText.length,
        sourceCount: sources.length,
        expandedButtons,
        answerSelector: answer.selector,
        candidateScore: match.score,
        candidateTextChars: match.text.length,
        candidateAnswerChars: answer.text.length,
        detectionEvidence: match.evidence,
      },
    });
  }

  GEO.registerScraper("google-aio", scrape);
})();
