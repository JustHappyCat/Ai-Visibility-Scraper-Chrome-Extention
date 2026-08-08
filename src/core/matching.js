// Pure target matching helpers. Page text and source metadata are untrusted.

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findBoundedTerm(text, term) {
  const source = String(text ?? "").normalize("NFKC");
  const needle = String(term ?? "").normalize("NFKC").trim();
  if (!source || !needle) return null;

  const rx = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(needle)})(?=$|[^\\p{L}\\p{N}])`, "iu");
  const match = source.match(rx);
  if (!match) return null;
  return {
    index: (match.index ?? 0) + (match[1] ? match[1].length : 0),
    term: match[2],
  };
}

export function normalizeHostname(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "").replace(/\.$/, "").toLowerCase();
  } catch {
    return raw.replace(/^www\./i, "").replace(/\.$/, "").toLowerCase();
  }
}

export function hostnameMatches(candidate, configured) {
  const actual = normalizeHostname(candidate);
  const expected = normalizeHostname(configured);
  return Boolean(actual && expected && (actual === expected || actual.endsWith(`.${expected}`)));
}

export function contextSnippet(text, index, size = 90) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const start = Math.max(0, index - size);
  const end = Math.min(source.length, index + size);
  return `${start > 0 ? "..." : ""}${source.slice(start, end)}${end < source.length ? "..." : ""}`;
}

function recordTextHit(collection, text, term, where) {
  const hit = findBoundedTerm(text, term);
  if (!hit) return;
  collection.push({ term, snippet: contextSnippet(text, hit.index), where });
}

function sourceHostname(source) {
  if (source?.domain) return normalizeHostname(source.domain);
  if (source?.url) return normalizeHostname(source.url);
  return "";
}

export function matchTarget(result, target) {
  const answerText = String(result?.answerText ?? "");
  const thinkingText = String(result?.thinkingText ?? "");
  const terms = [target?.name, ...(target?.aliases || [])].filter(Boolean);
  const domains = (target?.domains || []).map(normalizeHostname).filter(Boolean);
  const answerHits = [];
  const thinkingHits = [];
  const sourceHits = [];

  for (const term of terms) {
    recordTextHit(answerHits, answerText, term, "answer");
    recordTextHit(thinkingHits, thinkingText, term, "thinking");
  }
  for (const domain of domains) {
    recordTextHit(answerHits, answerText, domain, "answer");
    recordTextHit(thinkingHits, thinkingText, domain, "thinking");
  }

  for (const source of result?.sources || []) {
    const label = `${source?.text || ""}`;
    const hostname = sourceHostname(source);
    for (const term of terms) recordTextHit(sourceHits, label, term, "source");
    for (const domain of domains) {
      if (!hostnameMatches(hostname, domain)) continue;
      sourceHits.push({
        term: domain,
        snippet: `${hostname}${label ? ` — ${label}` : ""}`,
        where: "source",
      });
    }
  }

  const snippets = [...answerHits, ...thinkingHits, ...sourceHits];
  return {
    business: target?.name || "",
    aliases: target?.aliases || [],
    domains,
    mentioned: snippets.length > 0,
    inText: answerHits.length > 0,
    inAnswer: answerHits.length > 0,
    inThinking: thinkingHits.length > 0,
    inSources: sourceHits.length > 0,
    snippets: snippets.slice(0, 5),
  };
}

export function enrichResult(result, prompt, targets, classifyResult) {
  const clean = { ...result, prompt };
  clean.matches = (targets || []).map((target) => matchTarget(clean, target));
  clean.visibility = {
    businessCount: clean.matches.length,
    mentionedCount: clean.matches.filter((match) => match.mentioned).length,
  };
  if (classifyResult) clean.classification = classifyResult(clean);
  return clean;
}

