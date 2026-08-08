// Pure run-state helpers used to prevent stale and duplicate terminal writes.

export const TERMINAL_RUN_STATUSES = Object.freeze(["complete", "failed", "cancelled"]);

export function isTerminalRun(run) {
  return Boolean(run && TERMINAL_RUN_STATUSES.includes(run.status));
}

export function assertRunUpdateAllowed(existing, runId, nextStatus = existing?.status) {
  if (!existing || existing.id !== runId) throw new Error("Run is no longer active.");
  if (isTerminalRun(existing)) throw new Error(`Run is already ${existing.status}.`);
  const allowed = {
    running: new Set(["running", "cancelling", "complete", "failed", "cancelled"]),
    cancelling: new Set(["cancelling", "cancelled"]),
  };
  if (!allowed[existing.status]?.has(nextStatus)) {
    throw new Error(`Invalid run transition: ${existing.status} -> ${nextStatus}.`);
  }
  return true;
}

export function compactRunEnvelope(run, { ok = true, error = "", timestamp = Date.now() } = {}) {
  const envelope = {
    kind: "run",
    ok,
    run: {
      id: run?.id || "",
      status: run?.status || "unknown",
      completed: Number(run?.completed) || 0,
      total: Number(run?.total) || 0,
      failed: Number(run?.failed) || 0,
    },
    ts: timestamp,
  };
  if (error) envelope.error = String(error);
  return envelope;
}

export function compactScrapeEnvelope(result, { timestamp = Date.now() } = {}) {
  return {
    kind: "scrape",
    ok: true,
    result: {
      engine: result?.engine || "unknown",
      status: result?.status || "unknown",
      timestamp: result?.timestamp || null,
    },
    ts: timestamp,
  };
}

export function failureResult(engine, prompt, targets, error, status = "extraction-error") {
  return {
    engine,
    prompt,
    status,
    answerText: "",
    thinkingText: "",
    sources: [],
    error: String(error || "Extraction failed."),
    matches: (targets || []).map((target) => ({
      business: target.name,
      aliases: target.aliases || [],
      domains: target.domains || [],
      mentioned: false,
      inText: false,
      inAnswer: false,
      inThinking: false,
      inSources: false,
      snippets: [],
    })),
    classification: { kind: "failure", eligible: false, reason: status },
  };
}
