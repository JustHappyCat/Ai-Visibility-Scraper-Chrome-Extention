// Result status classification and visibility aggregation.

const SUCCESS_STATUSES = new Set(["ok"]);
const UNAVAILABLE_STATUSES = new Set(["no-ai-overview"]);

export function classifyResult(result) {
  const status = String(result?.status || "unknown");
  if (SUCCESS_STATUSES.has(status)) {
    return { kind: "success", eligible: true, reason: status };
  }
  if (UNAVAILABLE_STATUSES.has(status)) {
    return { kind: "unavailable", eligible: false, reason: status };
  }
  return { kind: "failure", eligible: false, reason: status };
}

export function withClassification(result) {
  return { ...result, classification: classifyResult(result) };
}

export function summarizeResults(run) {
  const byEngine = {};
  const byBusiness = {};
  const rows = [];
  const counts = { success: 0, unavailable: 0, failure: 0 };

  for (const rawResult of run?.results || []) {
    const classification = rawResult.classification || classifyResult(rawResult);
    counts[classification.kind] += 1;
    for (const match of rawResult.matches || []) {
      const row = { result: rawResult, match, classification };
      rows.push(row);
      byEngine[rawResult.engine] ||= { eligible: 0, mentioned: 0, unavailable: 0, failure: 0 };
      byBusiness[match.business] ||= { eligible: 0, mentioned: 0, unavailable: 0, failure: 0 };
      const engine = byEngine[rawResult.engine];
      const business = byBusiness[match.business];

      if (classification.eligible) {
        engine.eligible += 1;
        business.eligible += 1;
        if (match.mentioned) {
          engine.mentioned += 1;
          business.mentioned += 1;
        }
      } else {
        engine[classification.kind] += 1;
        business[classification.kind] += 1;
      }
    }
  }

  return { rows, byEngine, byBusiness, counts };
}

