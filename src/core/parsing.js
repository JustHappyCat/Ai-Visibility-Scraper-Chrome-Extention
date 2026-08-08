// Pure parsing helpers shared by the background worker and tests.

export function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function parsePrompts(raw) {
  return String(raw ?? "")
    .split(/\r?\n+/)
    .map(normalizeText)
    .filter(Boolean);
}

export function parseBoundedInteger(value, { fallback, min, max }) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function splitList(raw) {
  return String(raw ?? "")
    .split(",")
    .map(normalizeText)
    .filter(Boolean);
}

export function looksLikeDomain(value) {
  try {
    cleanDomain(value);
    return true;
  } catch {
    return false;
  }
}

export function cleanDomain(value) {
  const raw = normalizeText(value);
  if (!raw || /[\s|]/.test(raw)) throw new Error("Domain is empty or contains invalid whitespace.");

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid domain: ${raw}`);
  }

  const hostname = url.hostname.replace(/^www\./i, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || !hostname.includes(".") || !/^[a-z0-9.-]+$/i.test(hostname)) {
    throw new Error(`Invalid domain: ${raw}`);
  }
  if (hostname.split(".").some((part) => !part || part.length > 63 || part.startsWith("-") || part.endsWith("-"))) {
    throw new Error(`Invalid domain: ${raw}`);
  }
  return hostname;
}

function targetFromPipeFormat(line) {
  const parts = line.split("|").map(normalizeText);
  if (parts.length > 3) throw new Error("Expected: name | aliases | domains.");
  const name = parts[0];
  if (!name) throw new Error("Target name is required.");
  const aliases = splitList(parts[1]);
  const domains = splitList(parts[2]).map(cleanDomain);
  return { name, aliases, domains };
}

function targetFromLegacyCommaFormat(line) {
  const values = splitList(line);
  const name = values[0];
  if (!name) throw new Error("Target name is required.");
  return {
    name,
    aliases: values.slice(1).filter((value) => !looksLikeDomain(value)),
    domains: values.slice(1).filter(looksLikeDomain).map(cleanDomain),
  };
}

export function parseTargetsDetailed(raw) {
  const targets = [];
  const errors = [];
  String(raw ?? "")
    .split(/\r?\n/)
    .forEach((original, index) => {
      const line = normalizeText(original);
      if (!line) return;
      try {
        const target = line.includes("|")
          ? targetFromPipeFormat(line)
          : line.includes(",")
            ? targetFromLegacyCommaFormat(line)
            : { name: line, aliases: [], domains: [] };
        targets.push(target);
      } catch (error) {
        errors.push({ line: index + 1, input: line, error: String(error.message || error) });
      }
    });
  return { targets, errors };
}

export function parseTargets(raw) {
  const parsed = parseTargetsDetailed(raw);
  if (parsed.errors.length) {
    const detail = parsed.errors.map((item) => `line ${item.line}: ${item.error}`).join("; ");
    throw new Error(`Invalid target input (${detail}).`);
  }
  return parsed.targets;
}
