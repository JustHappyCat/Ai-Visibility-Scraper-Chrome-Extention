# GEO Visibility Scraper

GEO Visibility Scraper is an unpacked Chrome Manifest V3 extension for measuring
whether selected businesses, brands, or websites appear in AI-generated answers.
It runs prompts in ChatGPT, Google AI Overviews, and Perplexity, captures the
visible responses and citations, matches them against your targets, and exports
the results as CSV or a standalone HTML report.

The extension works through the browser interfaces of the supported sites. It
does not require API keys, call private engine APIs, or collect hidden
chain-of-thought. All extension state is stored locally in Chrome.

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
- Preserve form settings, the latest run, and up to 20 archived runs locally.
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

There is no build step and there are no package dependencies. After editing the
source, use **Reload** on `chrome://extensions` before testing the change.

## Quick start

1. Sign in to each engine you intend to use.
2. Click the extension icon. The dashboard opens in its own Chrome window.
3. Enter one or more prompts, separated by new lines or commas.
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

## Dashboard actions

| Action | What it does |
| --- | --- |
| **Start Batch** | Runs every prompt against every selected engine, sequentially. |
| **Cancel** | Stops the current run and closes temporary tabs. |
| **Scrape Active Tab** | Reads the currently visible supported page without submitting anything. |
| **Run Active Tab** | Runs the first entered prompt in the active supported tab. |
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

The extension automates the normal browser UI. Captchas, logged-out sessions,
rate limits, network errors, and page redesigns can interrupt a run. Use modest
batch sizes and a conservative delay, and comply with each site's applicable
terms and policies.

## Privacy and permissions

The extension stores prompts, target definitions, run results, settings, and
history in `chrome.storage.local`. It has no analytics or remote application
backend. Exported files are created locally by the dashboard.

Its permissions are limited to active-tab access, script injection, local
storage, tab management, and the supported ChatGPT, Google Search, and Perplexity
hosts. Review the detailed permission rationale and data model in
[DOCUMENTATION.md](DOCUMENTATION.md).

## Repository layout

```text
manifest.json                 Extension metadata, permissions, and registrations
src/background.js             Dashboard window, orchestration, matching, storage
src/common.js                 Shared extraction and message helpers
src/adapters/chatgpt.js       ChatGPT prompt automation and scraper
src/adapters/google-aio.js    Google AI Overview detection and scraper
src/adapters/perplexity.js    Perplexity prompt automation and scraper
src/popup/popup.html          Dashboard markup and styles
src/popup/popup.js            Dashboard state, rendering, and exports
DOCUMENTATION.md              Complete user and maintainer documentation
```

## Limitations

- Results reflect what the signed-in browser session received at that time;
  generated answers can vary between runs, users, regions, and engine modes.
- Matching is deterministic text matching, not semantic entity resolution.
- Only visibly rendered answer, activity/reasoning, and source content can be
  captured.
- Google AI Overviews may not be present for a query.
- Chrome may suspend Manifest V3 service workers during long unattended runs.
- The extension does not schedule runs, use engine APIs, or synchronize results
  between Chrome profiles.

## Detailed documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for the complete operating guide,
matching specification, output schema, architecture, message flow, storage
model, troubleshooting guide, and safe-maintenance checklist.
