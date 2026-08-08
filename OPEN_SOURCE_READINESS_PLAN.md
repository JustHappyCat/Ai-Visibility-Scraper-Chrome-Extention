# Open-Source Readiness Remediation Plan

Status: planning only  
Target release: experimental public beta  
Current extension version: `0.2.0`  
Last updated: 2026-08-08

## 1. Objective

Prepare GEO Visibility Scraper for a responsible open-source beta release by:

- correcting known data-quality and active-tab defects;
- adding automated validation for stable, pure logic and DOM adapters;
- tightening privacy, storage, permission, and export behavior;
- making the codebase easier for multiple contributors to maintain;
- adding the legal, governance, release, and contributor files expected in a
  public repository; and
- documenting unavoidable limitations caused by third-party UI automation.

This plan deliberately does not authorize implementation. Each work item should
be assigned, implemented, reviewed, and merged separately.

## 2. Release definition

The first public release should be described as an **experimental beta**, not as
a production-grade analytics system. A release is ready only when all P0 and P1
items in this document are complete and the final release gate passes.

### Success criteria

- The repository has an explicit OSI-compatible license selected by the owner.
- Normal Google search result pages cannot be reported as AI Overviews.
- Active-tab actions reliably operate on the intended supported tab, not the
  dashboard tab.
- Matching, parsing, export, result-status, and storage policies have automated
  tests.
- Each supported adapter has fixture tests and a documented live smoke test.
- Invalid or incomplete extraction does not silently reduce visibility scores.
- Storage growth is bounded by an explicit byte-aware policy.
- CI validates syntax, tests, manifest references, formatting, and repository
  hygiene on every change.
- Permissions and privacy claims match actual behavior.
- A clean Chrome profile can complete the release smoke-test matrix.

## 3. Constraints and guiding decisions

- Preserve Manifest V3 compatibility.
- Keep the extension local-first; do not add analytics, telemetry, or an
  application backend.
- Prefer deterministic fixtures over live-site tests in CI. Live tests require
  authenticated user sessions and are release checks, not merge checks.
- Keep scraped or user-entered text untrusted at every rendering/export boundary.
- Avoid a build step unless modularization and testing cannot be achieved cleanly
  without one. Record the decision before restructuring source files.
- Do not commit authenticated page captures, prompts, personal identifiers,
  cookies, session data, or proprietary generated responses as test fixtures.
- Site terms, automated-access policies, and rate limits must be reviewed at
  release time. This plan does not make a legal determination about them.

## 4. Coordination model for multiple agents

Use a single integration owner. Agents should work in separate branches or
worktrees and avoid editing files outside their assigned ownership unless the
integration owner approves it.

The inspected folder currently has no Git metadata. Before parallel coding:

1. Decide whether this folder is the canonical source.
2. Initialize or restore the intended Git repository.
3. Review the initial file set for sensitive data.
4. Create a clean baseline commit and protect the default branch.
5. Create one branch/worktree per workstream below.

### Shared rules

- One task ID per pull request unless two tasks are inseparable.
- Every behavior change requires tests and documentation in the same pull
  request.
- Rebase or merge the current integration branch before requesting final review.
- Do not resolve an overlapping-file conflict by discarding another agent's work.
- Attach test output and manual verification notes to every pull request.
- Changes to shared contracts under `src/core/`, result schemas, manifest
  permissions, or storage keys require integration-owner review.

### Suggested workstreams

| Workstream | Primary ownership | Tasks | Can start |
| --- | --- | --- | --- |
| A. Repository and governance | Root Markdown files, `.github/`, assets | GOV-01 through GOV-07 | Immediately after owner decisions |
| B. Active-tab and orchestration | `src/background.js`, future orchestration modules | CORE-01, CORE-02, CORE-08 | After TEST-01 skeleton |
| C. Google adapter correctness | `src/adapters/google-aio.js`, Google fixtures | ADP-01, ADP-04 | After TEST-02 fixture contract |
| D. Matching, parsing, and storage | Future `src/core/`, matching/storage tests | CORE-03 through CORE-07 | After ARCH-01 |
| E. ChatGPT and Perplexity adapters | Their adapter files and fixtures | ADP-02 through ADP-04 | After TEST-02 fixture contract |
| F. Test and CI infrastructure | Test configuration, scripts, `.github/workflows/` | TEST-01 through TEST-06 | Immediately after repository bootstrap |
| G. UI, exports, and accessibility | `src/popup/`, UI tests, icons/screenshots | UI-01 through UI-06 | After ARCH-01 and result contract |
| H. Documentation and release | `README.md`, `DOCUMENTATION.md`, release artifacts | DOC-01 through REL-05 | Draft early; finalize after behavior merges |

Because several workstreams touch documentation and tests, the assigned agent
should add focused source/tests first and leave final README and full regression
updates to Workstream H unless otherwise coordinated.

## 5. Dependency order

### Wave 0: owner decisions and repository baseline

- DEC-01: Select the license.
- DEC-02: Confirm the public project name, copyright holder, contact method, and
  security-reporting channel.
- DEC-03: Decide whether comma-separated prompts remain supported or prompts
  become newline-only.
- DEC-04: Define visibility denominator semantics for `no-ai-overview`,
  `no-answer-found`, extraction errors, and cancelled jobs.
- DEC-05: Decide the maximum retained history size and acceptable storage budget.
- GOV-01: Establish the Git baseline and run a current-tree secret scan.

No public release or parallel implementation should begin until DEC-01 through
DEC-05 are recorded in this document or a linked decision log.

### Wave 1: test skeleton and stable contracts

- ARCH-01: Define module boundaries and shared data contracts.
- TEST-01: Add the test runner and common test commands.
- TEST-02: Add sanitized DOM fixture conventions and adapter harnesses.
- TEST-03: Add manifest/reference validation.
- CORE-07: Formalize result statuses and score eligibility.

### Wave 2: parallel correctness work

- CORE-01 and CORE-02: Active-tab targeting and orchestration lifecycle.
- ADP-01: Google AI Overview detection.
- ADP-02: Perplexity latest-turn scoping.
- ADP-03: ChatGPT completion/failure detection.
- CORE-03 and CORE-04: Matching and prompt/target parsing.
- CORE-05 and CORE-06: Storage limits and data migration.
- UI-01 and UI-02: Score/report semantics and export hardening.

### Wave 3: maintainability, user experience, and hardening

- ARCH-02 through ARCH-04: Split large files and document contracts.
- CORE-08: Permission audit and least-privilege changes.
- ADP-04: Cross-adapter consistency.
- UI-03 through UI-06: Accessibility, responsive layout, icons, and safe reset UX.
- GOV-02 through GOV-07: Community and repository files.
- TEST-04 through TEST-06: Coverage, static checks, and CI.

### Wave 4: documentation and release validation

- DOC-01 through DOC-05.
- REL-01 through REL-05.

## 6. Detailed work items

### A. Legal, repository, and community readiness

#### GOV-01 — Establish repository provenance and baseline (P0)

Deliverables:

- Initialize or restore Git metadata.
- Confirm the canonical remote and default branch.
- Add a focused `.gitignore` for OS/editor/test artifacts without ignoring source
  or release assets.
- Scan the current tree and, if available, prior history for credentials,
  cookies, tokens, personal paths, private page captures, and generated exports.
- Record the baseline version and commit.

Acceptance criteria:

- `git status` is clean after the baseline commit.
- No known sensitive data is present in the tree or distributable archive.
- The source archive contains only intentional files.

#### GOV-02 — Add an open-source license (P0)

Blocked by DEC-01.

Deliverables:

- Add `LICENSE` using the exact standard license text.
- Add copyright and license references to `README.md`.
- If required by the selected license, add `NOTICE` and source headers through a
  separate reviewed mechanical change.

Acceptance criteria:

- A standard license detector recognizes the repository license.
- README licensing language matches the actual file.

#### GOV-03 — Contributor guide (P1)

Add `CONTRIBUTING.md` covering environment setup, loading unpacked, branch/PR
expectations, test commands, selector fixture rules, privacy rules, and live smoke
tests.

#### GOV-04 — Security policy (P1)

Add `SECURITY.md` with supported versions, private reporting instructions,
expected response process, and a warning not to include credentials or account
page captures in reports.

#### GOV-05 — Code of conduct (P1)

Add `CODE_OF_CONDUCT.md` and an enforcement contact selected by the owner.

#### GOV-06 — Issue and pull-request templates (P2)

Add templates for bugs, selector breakage, feature requests, and pull requests.
Selector reports should request sanitized debug information and explicitly forbid
cookies, session tokens, and private conversation content.

#### GOV-07 — Changelog and release process (P1)

Add `CHANGELOG.md`, adopt a versioning convention, and define how supported-site
breakage and selector-only fixes are released.

### B. Architecture and shared contracts

#### ARCH-01 — Record module and contract design (P0)

Before moving code, document:

- which pure functions belong in shared modules;
- how the MV3 service worker imports them;
- how popup code consumes shared logic;
- how classic content scripts remain compatible with Chrome injection;
- the canonical result, source, match, run, error, and settings schemas; and
- storage schema versioning and migrations.

Recommended pure boundaries:

- prompt/target parsing;
- domain normalization and matching;
- result classification and visibility aggregation;
- CSV/report data shaping and escaping;
- storage retention calculations; and
- manifest validation.

#### ARCH-02 — Split background responsibilities (P1)

Separate orchestration, tab lifecycle, storage, parsing, matching, and message
routing while keeping a small service-worker entry point.

Acceptance criteria:

- Pure logic is testable without a Chrome runtime.
- Chrome API calls are behind small injectable boundaries.
- Existing storage keys remain compatible or migrate explicitly.

#### ARCH-03 — Split popup structure and styling (P2)

Move styling to a dedicated local stylesheet and separate state/rendering/export
logic where doing so improves testability. Do not introduce remote assets.

#### ARCH-04 — Document internal contracts (P1)

Add concise JSDoc or equivalent documentation for shared schemas, status
transitions, cancellation behavior, and adapter registration.

### C. Core correctness and lifecycle

#### CORE-01 — Fix intended active-tab selection (P0)

Problem: the dashboard is opened and focused in its own window, while manual
actions query the active tab in the current window.

Required behavior:

- Capture the originating tab/window when the extension action is clicked.
- Prefer that supported tab for manual operations.
- If it is no longer available, select the most recently focused supported tab
  outside the dashboard window or ask the user to focus one.
- Never inject into extension pages or unsupported schemes.
- Show the selected engine, page title, and hostname before a manual run where
  practical.

Tests:

- Origin tab remains open and supported.
- Origin tab is closed before action.
- Dashboard already exists and is refocused.
- Multiple normal windows contain supported tabs.
- Active tab is unsupported, restricted, or an extension page.

#### CORE-02 — Harden run/cancel/restart lifecycle (P1)

- Define one state machine for idle, running, cancelling, complete, failed, and
  cancelled states.
- Prevent duplicate history archival and stale updates after reset/cancel.
- Recover clearly when the MV3 service worker restarts mid-run.
- Close only tabs created by the extension.
- Ensure retries use fresh sessions when required.
- Add bounded exponential backoff and optional jitter per engine.

#### CORE-03 — Make target matching structurally correct (P1)

- Use word/token boundaries for business names and aliases where appropriate.
- Compare configured domains with parsed source hostnames using exact or
  subdomain-aware rules, not arbitrary substring matching.
- Define Unicode, punctuation, case, `www`, IDN, port, and trailing-dot behavior.
- Reject or clearly flag malformed target domains.
- Preserve evidence snippets and the exact matched field.

Tests must include short aliases, punctuation, Unicode, overlapping names,
`example.com` versus `notexample.com`, subdomains, URLs containing another domain
in their path/query, and empty/malformed values.

#### CORE-04 — Improve prompt and target parsing (P1)

Blocked by DEC-03.

- Use one prompt per line because natural prompts commonly contain commas.
- Preserve backward compatibility through a documented migration if the format
  changes.
- Validate retry and delay values as finite integers within explicit limits.
- Report parsing errors with line numbers instead of silently accepting malformed
  data.

#### CORE-05 — Add byte-aware storage retention (P1)

Blocked by DEC-05.

- Estimate serialized bytes before writes.
- Bound history by both run count and total size.
- Avoid unnecessary duplication of full answer text among `geoRun`, `geoLast`,
  and `geoHistory`.
- Prune predictably and notify the dashboard when old data is removed.
- Handle `chrome.storage.local` quota errors without losing the active run.

#### CORE-06 — Version and migrate stored data (P1)

- Add a storage schema version.
- Migrate old settings/runs idempotently.
- Preserve export access to compatible historical data.
- Back up or fail safely when encountering a newer unknown schema.

#### CORE-07 — Formalize result validity and visibility denominators (P0)

Blocked by DEC-04.

At minimum distinguish:

- successful answer extraction;
- valid absence of an AI Overview;
- answer present but empty/unavailable;
- selector/extraction failure;
- authentication, captcha, rate-limit, and network failures;
- user cancellation; and
- unsupported page state.

Visibility summaries must not silently treat technical failures as genuine
non-mentions. Reports should display valid opportunities, unavailable results,
and failures separately.

#### CORE-08 — Audit permissions and message boundaries (P1)

- Demonstrate why each manifest permission and host permission is required.
- Remove redundant permissions where verified by clean-profile tests.
- Keep host access limited to supported origins.
- Validate message shapes and reject unknown or malformed fields.
- Confirm no page-originated code can trigger privileged background operations.

### D. Adapter correctness

#### ADP-01 — Fix Google AI Overview detection (P0)

Required behavior:

- Require positive AI Overview evidence before returning an overview container.
- Do not accept a generic `#rcnt` child merely because it has text.
- Do not fall back to the whole ordinary results column as answer text.
- Keep answer and citation extraction scoped to the proven overview container.
- Return `no-ai-overview` on normal SERPs.
- Retain useful, privacy-conscious debug evidence without storing unrelated page
  content.

Required fixtures:

- AI Overview present and expanded.
- AI Overview present and collapsed.
- No AI Overview.
- Knowledge panel but no AI Overview.
- Featured snippet but no AI Overview.
- Consent/captcha page.
- Markup variants represented by every retained fallback selector.

#### ADP-02 — Scope Perplexity extraction to the latest turn (P1)

- Identify the latest answer/turn container first.
- Search reasoning/activity and citations only within its bounded conversation
  context.
- Do not choose the longest reasoning-like element on the entire document.
- Do not collect navigation links when no answer root exists.
- Detect logged-out, rate-limited, and unfinished states explicitly.

#### ADP-03 — Harden ChatGPT completion detection (P1)

- Distinguish “generation never started,” “generation completed,” and “old answer
  remained unchanged.”
- Treat a fresh-chat submission that produces no answer as a failure, not a
  successful empty result.
- Scope answer, activity, and citations to the latest assistant turn.
- Add fixtures for temporary chat, standard chat, citations, activity panel,
  login page, rate limit, and interrupted generation.

#### ADP-04 — Normalize adapter behavior (P1)

All adapters should return the same required fields and consistent status/error
semantics. Add contract tests that run against every adapter fixture.

### E. UI, export, and privacy hardening

#### UI-01 — Display validity separately from visibility (P1)

- Show successful, unavailable, and failed counts separately.
- Explain the visibility denominator in the dashboard and exports.
- Preserve engine-specific valid-negative states such as no AI Overview.

#### UI-02 — Harden exports (P1)

- Keep HTML escaping centralized and tested.
- Extend CSV formula neutralization to dangerous prefixes preceded by whitespace
  or control characters.
- Add tests for quotes, CR/LF, Unicode, HTML, spreadsheet formulas, and very large
  fields.
- Include result validity/status fields needed to interpret percentages.
- Add a privacy reminder before exporting full prompts and answer text if the
  owner approves this UX.

#### UI-03 — Improve input validation and error recovery (P1)

- Show actionable validation errors next to the relevant field.
- Disable duplicate start actions while a run is active.
- Confirm destructive actions and report storage/reset failures.
- Make pruned history and interrupted runs visible to the user.

#### UI-04 — Accessibility review (P2)

- Verify keyboard-only operation, visible focus states, labels, heading order,
  status announcements, color contrast, reduced motion, and zoom behavior.
- Use an ARIA live region for run progress and errors where appropriate.

#### UI-05 — Responsive and visual polish (P2)

- Remove or justify the forced narrow-screen minimum width.
- Test common dashboard window sizes and 200% zoom.
- Add local extension icons at required sizes and a neutral screenshot set.

#### UI-06 — Data controls (P2)

- Consider separate actions for clearing settings, current run, and history.
- Explain exactly what each action removes and whether it can be recovered.

### F. Test and CI system

#### TEST-01 — Add a minimal test runner (P0)

Prefer the smallest toolchain that supports unit and fixture tests. Define at
least:

- `test` — complete deterministic suite;
- `test:unit` — pure logic;
- `test:adapters` — sanitized DOM fixtures;
- `check:syntax` — all JavaScript files;
- `check:manifest` — JSON and referenced-file validation; and
- `check` — the full pre-merge command.

Pin dependency versions and commit the lockfile if dependencies are introduced.

#### TEST-02 — Build a sanitized adapter fixture harness (P0)

- Store minimal HTML fragments, not full authenticated pages.
- Annotate the site state and expected result beside every fixture.
- Remove account names, prompts, cookies, tracking parameters, and generated
  content not needed for the selector test.
- Make selector additions include a regression fixture.

#### TEST-03 — Validate manifest and packaging (P0)

Automate checks that:

- `manifest.json` parses;
- version format is valid;
- every referenced script/style/icon exists;
- host and content-script matches are intentional;
- extension code contains no remote executable code; and
- the distributable archive excludes development and private artifacts.

#### TEST-04 — Add static quality checks (P1)

Add consistent formatting and linting with rules appropriate for browser,
service-worker, and content-script globals. Avoid a mass formatting change in the
same pull request as functional fixes.

#### TEST-05 — Add CI (P1)

Run the full deterministic check on supported Node versions and on pull requests.
Include dependency review and secret scanning if the hosting provider supports
them. CI must not log private site data or require live account credentials.

#### TEST-06 — Define coverage expectations (P2)

Require strong branch coverage for pure core modules. For adapters, require a
fixture for each status path and regression rather than chasing a repository-wide
percentage that rewards testing markup boilerplate.

### G. Documentation

#### DOC-01 — Correct user-facing behavior (P0)

Update README and detailed documentation after implementation so active-tab
selection, prompt parsing, result validity, score denominators, storage pruning,
and adapter limitations match actual behavior.

#### DOC-02 — Add a privacy and data-flow summary (P1)

Clearly distinguish:

- data stored in the Chrome profile;
- prompts sent to supported sites;
- text read from supported pages;
- data written into exports; and
- data never collected by the project.

Avoid implying that “local storage” means supported sites do not receive prompts.

#### DOC-03 — Add permission rationale and threat boundaries (P1)

Document each permission, why it is needed, what pages are in scope, and the
security assumptions around content scripts and runtime messages.

#### DOC-04 — Add testing and maintenance documentation (P1)

Document deterministic test commands, fixture sanitization, selector update
workflow, clean-profile smoke testing, and how to report site breakage.

#### DOC-05 — Add project-status and legal caveats (P1)

- Mark the project experimental.
- Explain third-party UI fragility and nondeterministic answers.
- Tell users to review applicable terms, account rules, rate limits, and law.
- State that visibility is lexical measurement, not sentiment, rank, accuracy, or
  endorsement.

### H. Release validation

#### REL-01 — Automated release gate (P0)

The following must pass from a clean checkout:

```text
install pinned development dependencies, if any
run syntax checks
run lint and formatting checks
run unit tests
run adapter fixture tests
validate manifest references
build the source archive
inspect the archive contents
```

Exact commands should replace this pseudocode after TEST-01 is implemented.

#### REL-02 — Clean-profile manual matrix (P0)

Test the unpacked release candidate in a clean Chrome profile:

| Area | Required cases |
| --- | --- |
| Installation | Fresh install, reload after update, uninstall/data warning |
| Dashboard | New window, existing window refocus, settings restoration |
| Active tab | Each engine, unsupported tab, closed origin tab, multiple windows |
| ChatGPT | New answer, citations, no answer/error, cancellation |
| Google | Overview present, collapsed overview, ordinary SERP, captcha/consent |
| Perplexity | New answer, citations/activity, no answer/error, cancellation |
| Batch | Multiple prompts/engines, retry, rate limit, cancellation, worker interruption |
| Matching | Names, aliases, exact domains, subdomains, false-positive controls |
| Storage | Large run, pruning, migration, quota error, clear/reset |
| Export | CSV in spreadsheet, HTML in browser, hostile text fixtures |
| Accessibility | Keyboard, focus, zoom, contrast, reduced motion |

Record browser/OS versions, account state, locale, test date, and sanitized
results. Do not commit authenticated captures.

#### REL-03 — Permission and privacy review (P0)

- Compare the final manifest with documentation.
- Confirm no analytics, remote code, secrets, or unintended network endpoints.
- Review data retained after completed, cancelled, and failed runs.
- Verify exported files disclose their full-data contents to the user.

#### REL-04 — Release artifacts (P1)

- Update version and changelog.
- Create a tagged source release and checksum.
- Include installation instructions and known limitations.
- Verify icons, screenshots, and archive contents.
- Do not include development fixtures containing non-public content.

#### REL-05 — Post-release maintenance process (P1)

- Define how selector breakages are triaged.
- Label supported versus temporarily broken engines.
- Set expectations for security fixes and compatibility updates.
- Maintain a regression fixture for every confirmed site breakage.

## 7. Merge and integration checkpoints

### Checkpoint 1 — Contracts frozen

Required: DEC-01 through DEC-05, ARCH-01, TEST-01, TEST-02, CORE-07.

The integration owner confirms schemas, statuses, score semantics, storage
budget, prompt format, and fixture contract before parallel behavior changes
merge.

### Checkpoint 2 — P0 correctness complete

Required: CORE-01, ADP-01, GOV-02, TEST-03, DOC-01 drafts.

Run the unit/fixture suite and manually verify ordinary Google results plus every
active-tab case before accepting further refactors.

### Checkpoint 3 — P1 hardening complete

Required: remaining P1 core, adapter, UI, testing, governance, and documentation
tasks. Run migrations and regression tests against a copy of representative
pre-release local storage.

### Checkpoint 4 — Release candidate

Required: REL-01 through REL-04. Freeze behavior changes; accept only release
blockers and documentation corrections until the release is tagged.

## 8. Pull-request acceptance template

Every implementation pull request should state:

```text
Task IDs:
Problem and user impact:
Files/contracts changed:
Security/privacy considerations:
Storage or migration impact:
Automated tests added:
Commands and results:
Manual checks performed:
Documentation updated:
Known limitations or follow-ups:
```

## 9. Final release checklist

- [ ] All P0 tasks complete.
- [ ] All P1 tasks complete or explicitly waived by the owner with rationale.
- [ ] License and copyright information confirmed.
- [ ] Current tree and release archive pass secret/privacy review.
- [ ] Deterministic CI is green from a clean checkout.
- [ ] Google ordinary-SERP regression tests pass.
- [ ] Active-tab multi-window regression tests pass.
- [ ] Matching false-positive tests pass.
- [ ] Result validity and denominator semantics are visible and documented.
- [ ] Storage migration, pruning, quota handling, and reset tests pass.
- [ ] CSV and HTML hostile-input tests pass.
- [ ] Clean-profile manual matrix is signed off.
- [ ] Permissions match the final documentation.
- [ ] README identifies the release as experimental beta.
- [ ] Changelog, version, tag, archive, icons, and screenshots are ready.
- [ ] Security and selector-breakage reporting channels work.

## 10. Deferred ideas after the first public beta

These should not delay the first release unless they become necessary to fix a
P0/P1 item:

- scheduled runs;
- cloud synchronization;
- official engine API integrations;
- semantic entity resolution;
- sentiment, rank, prominence, or citation-quality analysis;
- cross-browser support beyond Chromium;
- automatic selector update services; and
- remote telemetry or analytics.

Any future remote service or telemetry proposal requires a separate privacy,
security, consent, and architecture review.
