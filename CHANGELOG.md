# Changelog

All notable changes to this project are documented here. The project will follow
Semantic Versioning after its first public beta.

## Unreleased

### Added

- Added configurable Google Search country, language, optional UULE city/region,
  live URL preview, and desktop/mobile emulation for Google AI Overview runs.

## 0.3.0 — Experimental pre-release (2026-08-08)

### Added

- Deterministic Node.js unit and sanitized adapter-fixture tests, repository
  checks, and GitHub Actions CI on Node.js 22 and 24.
- Pure parsing, matching, result-classification, and byte-aware storage-policy
  modules.
- Stored-state schema version 1, history-pruning notices, and interrupted-run
  recovery that preserves partial results as a failed archived run.
- Contributor/community scaffolding, release planning, and local extension icons.

### Changed

- Marked the project as an experimental beta and expanded documentation for
  privacy, permissions, testing, fixtures, data flow, and limitations.
- Made prompts newline-delimited so commas remain part of a prompt.
- Updated Perplexity completion detection for unmarked answer prose on search routes and replaced the opaque wait timeout with an actionable error.
- Corrected manual active-tab actions to retain the supported page from which
  the dashboard was opened, with a recent-supported-tab fallback across windows.
- Classified results as successful, unavailable, or failed; visibility now uses
  only successfully extracted rows while unavailable surfaces and failures are
  reported separately.
- Limited archived history to the newest 20 runs within an approximate 8 MiB
  serialized-data budget.
- Tightened bounded name/alias matching and structural source-hostname matching.
- Scoped ChatGPT and Perplexity extraction to the latest relevant turn and
  hardened Google AI Overview detection against ordinary search results.

### Security

- Removed the redundant `activeTab` permission; explicit supported-site host
  permissions, `tabs`, and `scripting` cover the current workflows.
- Kept development fixtures synthetic or aggressively sanitized and added
  repository checks for common secret patterns and remote executable code.

## 0.2.0 — Pre-release

- Added batch runs across ChatGPT, Google AI Overviews, and Perplexity.
- Added target matching, local history, CSV export, and standalone HTML reports.
