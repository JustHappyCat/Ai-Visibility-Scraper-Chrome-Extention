# Contributing

Thank you for helping improve GEO Visibility Scraper. The project is an
experimental Manifest V3 Chrome extension whose adapters depend on changing
third-party interfaces. Small, tested, privacy-conscious changes are preferred.

## Development setup

1. Use a supported Node.js version listed by CI.
2. Install development dependencies if `package.json` declares any.
3. Run the complete local check documented by `npm run check`.
4. Open `chrome://extensions`, enable Developer mode, and load the repository
   folder as an unpacked extension.
5. Use a test Chrome profile without private conversations or confidential
   prompts when changing site adapters.

The extension has no production dependencies and no application backend.

## Change expectations

- Keep one focused problem or plan task ID per pull request.
- Add automated regression coverage for behavior changes.
- Update user and maintainer documentation in the same pull request.
- Do not add telemetry, remote code, or new host permissions without an explicit
  privacy and security review.
- Do not commit generated exports, cookies, credentials, authenticated page
  captures, personal identifiers, or proprietary answer content.
- Preserve existing storage data or provide an idempotent migration.
- Treat scraped text, page URLs, stored state, and runtime messages as untrusted.

## Adapter fixtures

Use the fixture conventions under `tests/fixtures/`. Fixtures must be minimal
sanitized HTML fragments. Remove account names, prompts, session information,
tracking parameters, and unrelated generated content. Every selector regression
should include a fixture that fails before the fix and passes afterward.

CI uses deterministic fixtures and must never require live account credentials.
Live-site checks are performed manually before a release.

## Pull requests

Include:

- the plan task ID and user impact;
- files and shared contracts changed;
- security, privacy, and storage implications;
- automated test commands and results;
- manual Chrome checks performed; and
- known limitations or follow-up work.

Selector-only changes still require sanitized regression fixtures. Avoid mixing
large mechanical formatting changes with functional changes.

## Reporting problems

Use the appropriate issue template. For vulnerabilities, follow `SECURITY.md`
after it is published. Never post credentials, cookies, private conversations,
or unsanitized authenticated DOM captures in a public issue.

