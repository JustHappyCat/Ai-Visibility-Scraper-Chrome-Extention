# Architecture and Contracts

## Runtime boundaries

The extension has three execution environments:

1. The Manifest V3 background service worker owns privileged Chrome APIs,
   orchestration, storage, and run state.
2. The dashboard extension page owns form state, presentation, and local export
   initiation.
3. Classic content scripts run in Chrome's isolated world on supported sites and
   own DOM automation and extraction.

Page DOM, scraped text, source URLs, stored data, and runtime-message payloads are
untrusted inputs. Only the background worker may create, navigate, or close tabs.

## Module direction

New pure modules should live under `src/core/` and must not depend on `chrome`,
`window`, or `document`. The background service worker may import them directly.
Dashboard code may either import browser-safe pure modules as ES modules or use a
small dashboard-specific wrapper. Content scripts remain classic scripts; shared
adapter helpers stay under the guarded `window.GEO` namespace unless a build step
is deliberately introduced later.

Recommended pure modules:

- `parsing.js`: prompts, targets, numeric settings, domain normalization.
- `matching.js`: boundary-aware names/aliases and structural hostname matching.
- `results.js`: status classification, validity, and aggregation.
- `storage-policy.js`: serialization-size estimates and deterministic pruning.
- `exports.js`: tabular shaping and context-appropriate escaping.

## Canonical result contract

An adapter result has these required fields:

```text
engine         supported engine identifier
url            page URL at extraction time
timestamp      ISO-8601 timestamp
answerText     visible answer prose, possibly empty
thinkingText   visible activity/reasoning summary, possibly empty
sources        normalized visible citations
status         adapter status identifier
debug          bounded, privacy-conscious extraction metadata
```

The background enriches this with `prompt`, `matches`, `visibility`, and a
normalized classification:

```text
classification.kind      success | unavailable | failure
classification.eligible  whether it is in the visibility denominator
classification.reason    stable machine-readable reason
```

Adapters should throw for automation failures and return an explicit result only
for page states they successfully classified. `no-ai-overview` is unavailable,
not a failed job. `no-answer-found` and `ai-overview-empty` are extraction
failures unless a site-specific contract explicitly proves a valid empty state.

## Run state machine

```text
idle -> running -> complete
               -> cancelling -> cancelled
               -> failed
```

- Only one run may be active.
- Cancellation is idempotent.
- A run is archived at most once by ID.
- Reset prevents stale asynchronous writes from repopulating cleared storage.
- Extension-created tab IDs are tracked explicitly; user tabs are never closed.
- A service-worker restart must not present a persisted `running` run as healthy;
  it should be recovered or marked interrupted with an actionable reason.

## Storage contract

Storage schema changes are versioned. Migrations are idempotent and execute
before state is returned to the dashboard. Retention obeys the 8 MiB soft budget
and 20-run maximum recorded in `DECISIONS.md`.

## Adapter contract

- Select the latest answer surface before extracting child content.
- Keep reasoning/activity and citations inside the selected answer/turn scope.
- Require positive site-specific evidence; do not treat generic page prose as an
  answer.
- Return bounded debug metadata rather than broad raw page text.
- Detect login, consent, captcha, rate-limit, and incomplete-generation states
  separately where the DOM provides reliable evidence.
- Every retained selector or state branch requires a sanitized fixture.

## Security invariants

- No remote executable code, analytics, or application backend.
- Privileged messages are schema-validated and accepted only from extension
  contexts expected by the operation.
- Script injection is restricted to supported HTTPS origins.
- HTML output is escaped for its context; CSV output neutralizes spreadsheet
  formulas even after leading whitespace/control characters.
- Stored and exported content is treated as potentially confidential.
- Debug output must not contain cookies, tokens, hidden page state, or unrelated
  conversation/search content.

