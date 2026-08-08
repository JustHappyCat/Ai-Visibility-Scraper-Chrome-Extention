# GEO Visibility Scraper

> **Experimental beta:** this extension automates changing third-party website
> interfaces. Expect selector breakage, verify important results manually, and
> use conservative run sizes.

GEO Visibility Scraper is an unpacked Chrome Manifest V3 extension for measuring
whether selected businesses, brands, or websites appear in AI-generated answers.
It runs prompts in ChatGPT, Google AI Overviews, and Perplexity, captures the
visible responses and citations, matches them against your targets, and exports
the results as CSV or a standalone HTML report.

The extension works through the browser interfaces of the supported sites. It
does not require API keys, call private engine APIs, or collect hidden
chain-of-thought. Extension state is stored locally in Chrome; prompts submitted
by the extension are still sent to the selected supported website.

## Features

- Run a list of prompts across one or more supported engines.
- Track multiple businesses in the same run.
- Match business names, aliases, and domains in answer text, visible activity or
  reasoning summaries, and cited sources.
- Inspect progress, errors, recent results, and visibility percentages from the
  dashboard.
- Retry failed prompt/engine jobs and add a configurable delay between jobs.
- Scrape a supported active tab without submitting a prompt.
- Run one prompt in a supported active tab for testing.
- Preserve form settings, the latest run, and up to 20 archived runs locally,
  subject to an 8 MiB history budget.
- Export Excel-friendly CSV data and a self-contained HTML summary.

## Supported engines

| Engine | Prompt submission | Answer text | Visible activity/reasoning | Sources |
| --- | --- | --- | --- | --- |
| ChatGPT | Yes | Yes | When displayed by the site | Yes |
| Google AI Overview | Search URL | Yes, when an overview appears | No | Yes |
| Perplexity | Yes | Yes | When displayed by the site | Yes |

Site interfaces change frequently, so scraping selectors may require periodic
maintenance. Google does not show an AI Overview for every query; the extension
records that case as a valid `no-ai-overview` result.

## Install from source

Requirements:

- A Chromium-based browser with Manifest V3 extension support. The extension is
  designed and documented for Google Chrome.
- Access to the supported websites. Sign in first when a site requires it.

Installation:

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository folder containing `manifest.json`.
6. Pin the extension from Chrome's Extensions menu if desired.

There is no build step or runtime package dependency. Node.js 22 or newer and
`npm` are needed only for the deterministic development checks. After editing
the source, use **Reload** on `chrome://extensions` before testing the change.

## Quick start

1. Sign in to each engine you intend to use.
2. Click the extension icon. The dashboard opens in its own Chrome window.
3. Enter one or more prompts, with one prompt per line. Commas remain part of a
   prompt.
4. Enter one target business per line using this format:

   ```text
   Business Name | alias one, alias two | example.com, example.org
   ```

5. Select the engines to query.
6. Choose the delay between jobs and the number of retries.
7. Select **Start Batch**.
8. When results are available, select **Export CSV** or **Export Report**.

Example targets:

```text
Acme CRM | Acme, Acme Software | acme.com
Northwind | Northwind Analytics | northwind.ai, northwind.com
```

The name is required. Aliases and domains are optional. For additional accepted
input forms and exact matching behavior, see [DOCUMENTATION.md](DOCUMENTATION.md).

## Screenshots

### Configure a campaign

Enter one prompt per line, define the target name, aliases, and domains, then
choose the engines to include in the batch.

![Configured campaign with three prompts, one target business, and all engines enabled](assets/screenshots/Dashboard%20prompt.png)

### Review visibility results

The completed-run view separates successful, unavailable, and failed jobs and
shows visibility by engine and business.

![Completed run summary with visibility by engine and business](assets/screenshots/Run%20result.png)

Each result card identifies where the target matched and includes a bounded
answer or source excerpt for review.

![Result cards from ChatGPT, Google AI Overview, and Perplexity](assets/screenshots/Run%20result2.png)

### Export the run

CSV exports provide analysis-ready result rows, while HTML exports provide a
standalone report that can be opened without the extension.

![CSV export opened in a spreadsheet](assets/screenshots/Exported%20CSV.png)

![Standalone HTML report showing prompt-level details](assets/screenshots/Exported%20HTML%20Report.png)

These screenshots contain example prompts, target data, generated excerpts, and
source fragments. Review demonstration data before reusing the images publicly.

## Dashboard actions

| Action | What it does |
| --- | --- |
| **Start Batch** | Runs every prompt against every selected engine, sequentially. |
| **Cancel** | Stops the current run and closes temporary tabs. |
| **Scrape Active Tab** | Reads the supported page from which the dashboard was opened, without submitting anything. |
| **Run Active Tab** | Runs the first entered prompt in that supported page. |
| **Export CSV** | Downloads one row per result and target-business combination. |
| **Export Report** | Downloads a standalone HTML visibility summary. |
| **Clear History** | Removes archived runs but keeps settings and the current/latest run. |
| **Refresh + Clear Data** | Clears all locally stored extension data and reloads the extension. |

## How a batch works

The background service worker creates a job for every prompt/engine pair. Google
queries use a temporary search tab. ChatGPT and Perplexity use background tabs
that are returned to a new conversation before each prompt and replaced after
five uses. The matching step runs after each scrape, and progress is persisted
after each job so partial results remain available if a run is interrupted.

Results are classified before aggregation. An `ok` result is successful and is
eligible for visibility scoring. Google `no-ai-overview` is a valid unavailable
surface and is excluded from the denominator. Empty or otherwise failed
extractions are technical failures, are retried when configured, and are also
excluded. Visibility is mentions divided by eligible target-result rows, while
unavailable surfaces and failures are reported separately.

If Chrome restarts the Manifest V3 worker during a run, the next dashboard state
read marks the stale run `failed`, records a `worker-interrupted` error, and
archives the partial run. Jobs are not automatically resumed.

The extension automates the normal browser UI. Captchas, logged-out sessions,
rate limits, network errors, and page redesigns can interrupt a run. Use modest
batch sizes and a conservative delay, and comply with each site's applicable
terms and policies.

## Privacy and permissions

The extension stores prompts, target definitions, full scraped answer/activity
text, citations, errors, settings, and run history in `chrome.storage.local`.
It has no analytics or project-operated remote backend. Exported files are
created locally by the dashboard and may contain full prompts and scraped text.

Its permissions are limited to script injection, local/session storage, tab and
window management, and explicit access to the supported ChatGPT, Google Search,
and Perplexity hosts. Review the detailed permission rationale and data model in
[DOCUMENTATION.md](DOCUMENTATION.md).

## Repository layout

```text
manifest.json                 Extension metadata, permissions, and registrations
src/background.js             Dashboard window, orchestration, tabs, and storage
src/common.js                 Shared extraction and message helpers
src/core/                     Parsing, matching, result, and storage policy modules
src/adapters/chatgpt.js       ChatGPT prompt automation and scraper
src/adapters/google-aio.js    Google AI Overview detection and scraper
src/adapters/perplexity.js    Perplexity prompt automation and scraper
src/popup/popup.html          Dashboard markup and styles
src/popup/popup.js            Dashboard state, rendering, and exports
tests/                        Unit tests and sanitized adapter fixtures
scripts/                      Deterministic repository checks and test runner
.github/workflows/ci.yml      Node 22/24 continuous integration
DOCUMENTATION.md              Complete user and maintainer documentation
```

## Development checks

Run the complete deterministic check from the repository root:

```sh
npm ci
npm run check
```

Focused commands are `npm test`, `npm run test:unit`, and
`npm run test:adapters`. Adapter tests use minimal synthetic or aggressively
sanitized DOM fragments under `tests/fixtures/`; they do not require live
accounts. Every selector regression should add a paired fixture and metadata
case. CI runs the full check on Node.js 22 and 24. Live clean-profile checks are
still required before a release because fixtures cannot detect every site or
account variation.

## Limitations

- Results reflect what the signed-in browser session received at that time;
  generated answers can vary between runs, users, regions, and engine modes.
- Matching is deterministic text matching, not semantic entity resolution.
- Only visibly rendered answer, activity/reasoning, and source content can be
  captured.
- Google AI Overviews may not be present for a query.
- Chrome may suspend Manifest V3 service workers during long unattended runs.
- Interrupted jobs are marked failed and preserved as partial runs; they are not
  automatically resumed.
- History is pruned newest-first to at most 20 runs and an approximate 8 MiB
  budget. A large current run can still exhaust Chrome storage.
- Stored state is marked with schema version 1. Automatic runtime migrations
  beyond that initial schema are not yet implemented.
- The extension does not schedule runs, use engine APIs, or synchronize results
  between Chrome profiles.

## Detailed documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for the complete operating guide,
matching specification, output schema, architecture, message flow, storage
model, troubleshooting guide, and safe-maintenance checklist.
