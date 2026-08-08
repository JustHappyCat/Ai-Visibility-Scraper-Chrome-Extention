# Threat Model

## System and assets

GEO Visibility Scraper is a local Manifest V3 browser extension. It opens or
reuses tabs on supported AI/search sites, submits user prompts through their
visible interfaces, extracts rendered answer content and citations, performs
local lexical matching, stores run state in the Chrome profile, and creates local
CSV or HTML exports.

Assets requiring protection include:

- prompts, target definitions, scraped answer/activity text, citations, and run
  history;
- the user's authenticated sessions on supported sites;
- the extension's privileged ability to create, navigate, inspect, and close
  tabs; and
- the integrity of visibility calculations and exported reports.

## Trust boundaries

- Supported-site DOM and URLs cross from third-party pages into content scripts.
- Content-script results cross a runtime-message boundary into the background
  service worker.
- Dashboard form data crosses a privileged runtime-message boundary.
- Run data crosses from the worker into `chrome.storage.local` and later into the
  dashboard.
- Scraped and user-provided data crosses into CSV and standalone HTML files.
- Manual actions select an existing user tab; batch actions create temporary tabs
  that the extension is allowed to close.

## Attacker capabilities considered

- A supported site can render malicious or malformed text, links, attributes,
  oversized content, and rapidly changing DOM state.
- A user may paste malformed targets, domains, numeric settings, or spreadsheet
  formula payloads.
- Another installed extension or an unexpected extension context may attempt to
  send malformed messages if Chrome permits a route.
- A generated answer may contain HTML-looking text or spreadsheet formulas.
- A site redesign, captcha, login state, or service-worker restart may produce an
  ambiguous partial result that could corrupt analytics.

The model does not treat a person with control of the Chrome profile or operating
system account as an external attacker. Chrome itself and the browser's extension
isolation/storage enforcement are trusted platform controls.

## Security objectives

- Inject scripts only into explicitly supported HTTPS origins.
- Accept privileged operations only from expected extension contexts and validate
  all message fields before use.
- Never close a tab unless the extension created and tracked it.
- Escape HTML output and neutralize spreadsheet formulas.
- Keep local data bounded and make pruning/failure visible.
- Do not add remote executable code, telemetry, analytics, or an application
  backend without a new security/privacy review.
- Keep extraction scoped so unrelated page or conversation content is not stored.
- Fail closed on ambiguous extraction instead of reporting a false non-mention.

## Known and accepted beta risks

- Third-party DOM selectors can break without notice.
- UI automation may encounter rate limits, captchas, or site policy restrictions.
- Local Chrome-profile storage is not encrypted by this extension.
- Generated answers and visibility measurements are nondeterministic.
- Clean-profile live testing cannot be fully automated in public CI without
  introducing account credentials, which the project intentionally avoids.

These limitations are reportable when implementation behavior violates the
documented fail-closed, privacy, tab-ownership, or output-escaping controls. A
selector merely becoming stale is a compatibility bug unless it causes broader
content capture, privileged misuse, or misleading success classification.

