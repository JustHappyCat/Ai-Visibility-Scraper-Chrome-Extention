# GEO Visibility Scraper Documentation

## 1. Purpose and scope

GEO Visibility Scraper measures the appearance of target businesses, brands,
and websites in browser-rendered AI answers. It is intended for repeatable
Generative Engine Optimization research, visibility checks, and result exports.

The extension:

- operates in the user's normal Chrome session;
- submits prompts through supported website interfaces;
- captures visible answer text, visible activity/reasoning summaries, and cited
  links where the site exposes them;
- compares that content with user-defined names, aliases, and domains;
- saves run state locally; and
- produces CSV and HTML files in the browser.

It does not use engine APIs, require API keys, read hidden chain-of-thought,
provide semantic entity resolution, or send results to an application server.

## 2. Supported platforms

| Engine | Supported URLs | Automation method | Important behavior |
| --- | --- | --- | --- |
| ChatGPT | `https://chatgpt.com/*`, `https://chat.openai.com/*` | Types into the page composer and waits for completion | Uses a temporary-chat home URL for batch tabs; captures the latest assistant turn. |
| Google AI Overview | `https://www.google.com/search*` | Navigates to a search URL containing the prompt | Records `no-ai-overview` when no overview is detected. |
| Perplexity | `https://www.perplexity.ai/*`, `https://perplexity.ai/*` | Types into the page composer and waits for a new answer | Captures the latest answer-like prose container. |

Chrome is the target browser. The implementation uses Manifest V3 APIs,
including a background service worker, content scripts, `chrome.scripting`,
`chrome.tabs`, and `chrome.storage.local`.

## 3. Installation

### Prerequisites

- Google Chrome or a compatible Chromium browser.
- Access to the supported sites.
- A signed-in session where a supported site requires authentication.

### Load the extension

1. Clone or download the repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the directory containing `manifest.json`.
6. Optionally pin the extension from Chrome's Extensions menu.

The project uses plain HTML, CSS, and JavaScript. There is no compilation,
dependency installation, environment file, API key, or configuration file.

After a source change, select **Reload** for the extension on
`chrome://extensions`. Refresh any already-open supported website before testing
content-script changes.

## 4. Preparing a run

Click the extension action to open the dashboard. If its dashboard window is
already open, the extension focuses that window instead of creating another.

### Prompts

Enter prompts separated by new lines or commas. Empty entries are discarded.
Both examples below create three prompts:

```text
Best CRM for a small agency
Best accounting software for a startup
Best project management tool for consultants
```

```text
Best CRM for a small agency, Best accounting software for a startup, Best project management tool for consultants
```

Because commas are separators, a prompt containing a meaningful comma will be
split into separate prompts. Use phrasing without commas when the prompt must
remain one job.

### Target businesses

The recommended format is one target per line:

```text
Business Name | alias one, alias two | example.com, example.org
```

Examples:

```text
Acme CRM | Acme, Acme Software | acme.com
Northwind | Northwind Analytics | northwind.ai, northwind.com
Contoso
```

Parsing rules:

- Text before the first `|` is the required display name.
- The second field is an optional comma-separated alias list.
- The third field is an optional comma-separated domain list.
- Additional `|` fields are ignored.
- A domain may include a scheme or `www.`; it is normalized to its lowercase
  hostname.
- A line with no `|` but containing commas is also accepted. The first item is
  used as the name, domain-looking items become domains, and the remaining items
  become aliases.
- Blank lines and targets with an empty name are ignored.

Use specific aliases. A short or generic alias can create false positives,
especially because source and visible-activity matching uses substring checks.

### Engines, delay, and retries

- Select one or more engines. Each selected engine creates one job for each
  prompt.
- **Delay (ms)** is the pause after every prompt/engine job. The default is
  3,000 ms. Negative input is treated as zero.
- **Retries** is the number of additional attempts after an initial failure. The
  default is one and the implementation caps it at two.

The total job count is:

```text
number of prompts x number of selected engines
```

Jobs run sequentially in prompt-first, engine-second order. A failed attempt is
retried before the runner advances to the next job.

## 5. Running and controlling a batch

Select **Start Batch**. The background service worker validates that there is at
least one prompt, one target, and one engine, then creates a run.

For each job, it:

1. opens or prepares a background tab for the selected engine;
2. ensures the shared helper and correct engine adapter are present;
3. submits the prompt, or loads a Google search URL;
4. waits for the answer page to settle;
5. scrapes visible content and sources;
6. matches every configured target;
7. saves the result and updated progress to local storage; and
8. waits for the configured delay before continuing.

ChatGPT and Perplexity each reuse a background tab for up to five prompts. The
tab is navigated back to the engine home before every prompt after the first, so
prompts begin in fresh conversations. Google uses a new temporary tab for each
query. Temporary tabs are closed when no longer needed.

The dashboard updates when run or history state changes. It shows:

- run status and current job;
- completed and total job counts;
- failure count and archived-run count;
- mention percentage by engine;
- mention percentage by business;
- up to eight recent results; and
- up to four recent errors.

Select **Cancel** to request cancellation, close temporary tabs, mark a running
run as `cancelled`, and archive it. Cancellation is checked between and during
wait operations; a currently executing browser action may take a short time to
stop.

Only one batch or active-tab prompt run can execute at a time.

## 6. Active-tab tools

### Scrape Active Tab

**Scrape Active Tab** injects the shared helper and appropriate adapter into the
currently active supported tab, then reads the page without submitting a new
prompt. The raw result is displayed as formatted JSON in the dashboard.

Use this for:

- checking an answer already open in the browser;
- diagnosing selector changes;
- confirming detected answer character counts and source counts; or
- inspecting a `no-answer-found`, `no-ai-overview`, or empty result.

### Run Active Tab

**Run Active Tab** takes the first prompt from the prompt field and runs it in
the current supported tab. Targets are read from the current form.

- ChatGPT and Perplexity receive the prompt through their current composer.
- A Google tab is navigated to the corresponding search query before scraping.

This action creates and archives a normal one-job run, so it can be exported.
It intentionally uses only the first prompt.

## 7. Matching behavior

Matching happens locally in `src/background.js` after an adapter returns a
scrape result.

For each target:

- The business name and aliases are matched case-insensitively in answer text
  with non-alphanumeric boundaries. For example, `Acme` matches `Acme CRM` but
  does not match `Acmeology`.
- Domains are matched case-insensitively as substrings in answer text.
- Names, aliases, and domains are matched case-insensitively as substrings in
  visible activity/reasoning text.
- Names, aliases, and domains are matched against one combined string containing
  every source domain, URL, and visible link label.

The generated flags are:

| Field | Meaning |
| --- | --- |
| `mentioned` | At least one hit exists in answer text, visible activity/reasoning, or sources. |
| `inText` | A name, alias, or domain was found in answer text. |
| `inAnswer` | Same current meaning as `inText`; retained explicitly in result data. |
| `inThinking` | A term was found in visible activity/reasoning text. |
| `inSources` | A term was found in source domain, URL, or visible source text. |

Up to five snippets are stored per target, in answer-hit, activity/reasoning-hit,
then source-hit order. The first available snippet is shown in the dashboard and
included in each CSV/report detail row.

Visibility percentages are row based. If a run has five prompts, three engines,
and two targets, it can produce 30 target-result rows. Each business percentage
is its mentioned rows divided by its total rows; each engine percentage is the
same calculation across all targets for that engine.

## 8. Engine adapters

### Shared helper

`src/common.js` provides whitespace normalization, selector fallbacks, link
collection, domain extraction, visible activity/reasoning discovery, standard
payload creation, local result persistence, and content-script message routing.
It guards against double initialization when scripts are injected more than
once.

Prompt jobs run asynchronously inside a content script. The background worker
starts a job, receives a job identifier, and polls its status until it completes,
fails, or reaches the 210-second polling timeout.

### ChatGPT

The adapter selects the latest assistant turn, reads its Markdown/prose content,
attempts to expand a visible Activity/Thinking/Reasoning control, and gathers
external citation links from that turn. During automation it fills the composer,
submits the prompt, waits for generation to start and finish, and checks that a
new answer replaced the prior answer.

The adapter captures only a summary or activity panel that ChatGPT visibly
renders. It does not access hidden reasoning.

### Google AI Overview

The adapter searches for several known AI Overview roots, scores candidate
containers, expands **Show more** controls, removes interface/footer text, and
collects non-Google source links. Since Google uses frequently changing and
obfuscated markup, this adapter intentionally contains multiple selector
fallbacks and diagnostic fields.

Possible normal statuses include:

- `ok`: a useful overview answer was extracted;
- `no-ai-overview`: no overview block was detected; and
- `ai-overview-empty`: a likely overview was detected but no useful answer text
  remained after cleanup.

### Perplexity

The adapter selects the latest visible answer-like Markdown/prose container,
looks for visible Activity/Thinking/Reasoning/Steps content, and collects
external links. During automation it fills the composer, submits the prompt,
waits for a changed answer of useful length, then scrapes it.

## 9. Result and run data

A successful adapter result is enriched into a structure similar to:

```json
{
  "engine": "chatgpt",
  "prompt": "Best CRM for a small agency",
  "url": "https://chatgpt.com/...",
  "timestamp": "2026-07-28T10:00:00.000Z",
  "answerText": "...",
  "thinkingText": "...",
  "sources": [
    { "url": "https://example.com/page", "text": "Example", "domain": "example.com" }
  ],
  "status": "ok",
  "debug": {
    "answerChars": 1200,
    "thinkingChars": 240,
    "sourceCount": 4
  },
  "matches": [
    {
      "business": "Acme CRM",
      "aliases": ["Acme"],
      "domains": ["acme.com"],
      "mentioned": true,
      "inText": true,
      "inAnswer": true,
      "inThinking": false,
      "inSources": false,
      "snippets": [
        { "where": "answer", "term": "Acme CRM", "snippet": "..." }
      ]
    }
  ],
  "visibility": {
    "businessCount": 1,
    "mentionedCount": 1
  }
}
```

A run contains its identifier, status, parsed prompts and targets, selected
engines, delay, retry count, total/completed/failed counts, results, errors, the
current job when applicable, and ISO timestamps. Run identifiers begin with
`geo-`; active-tab run identifiers begin with `geo-active-`.

## 10. Local storage

All extension-managed state is in `chrome.storage.local`:

| Key | Contents |
| --- | --- |
| `geoSettings` | Last form values: raw prompts, raw targets, engines, delay, and retries. |
| `geoRun` | Current run or most recently updated run. |
| `geoHistory` | Up to 20 completed, cancelled, or failed archived runs, newest first. |
| `geoLast` | Compatibility/debug envelope containing the most recent result, run update, pending message, or error. |

Form settings autosave shortly after edits and once more when the dashboard
closes. Run progress is saved after each job.

**Clear History** empties only `geoHistory`. **Refresh + Clear Data** asks for
confirmation, clears all extension local storage, reloads the extension, and
resets the dashboard fields to defaults.

Uninstalling the extension normally removes its Chrome-managed local storage.
Export any results you need before uninstalling or clearing data.

## 11. Exports

Exports use the current/latest run if one exists; otherwise the newest archived
run is used. Export buttons are enabled when that run has results.

### CSV

The downloaded filename is:

```text
geo-results-<run-id>.csv
```

There is one row for every result/target combination. Columns are:

| Column | Description |
| --- | --- |
| `run_id` | Run identifier. |
| `prompt` | Submitted prompt. |
| `engine` | Internal engine key. |
| `business` | Target display name. |
| `mentioned` | `Yes` when any tracked location matched. |
| `in_text` | `Yes` when answer text matched. |
| `in_answer` | Explicit answer-match flag. |
| `in_thinking` | `Yes` when visible activity/reasoning matched. |
| `in_sources` | `Yes` when source metadata matched. |
| `snippet` | First stored context snippet. |
| `source_domains` | Semicolon-separated cited domains. |
| `status` | Adapter result status. |
| `answer_chars` | Answer character count. |
| `answer_text` | Full extracted answer text. |
| `thinking_chars` | Visible activity/reasoning character count. |
| `thinking_text` | Full extracted visible activity/reasoning text. |
| `url` | Page URL at scrape time. |
| `source_urls` | Semicolon-separated source URLs. |
| `source_texts` | Source domains and visible labels. |
| `timestamp` | Adapter timestamp in ISO format. |

The file uses UTF-8 with a byte-order mark and Windows-style line endings for
spreadsheet compatibility. Values beginning with spreadsheet formula characters
are prefixed with an apostrophe unless they are numeric, reducing formula
injection risk when the CSV is opened in spreadsheet software.

### HTML report

The downloaded filename is:

```text
geo-report-<run-id>.html
```

It is a standalone file with run metadata, visibility by engine, visibility by
business, and prompt-level target rows. It does not require the extension to view
and can be opened locally or shared as a file. Review scraped content before
publishing a report because it may contain generated text, source URLs, and
prompt data.

## 12. Permissions and privacy

### Chrome permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Allows manual actions to work with the user-selected active tab. |
| `scripting` | Injects the shared helper and correct adapter when needed. |
| `storage` | Persists settings, progress, history, and results locally. |
| `tabs` | Opens, navigates, observes, focuses, and closes dashboard/worker tabs. |

Host access is declared only for supported ChatGPT, Google Search, and
Perplexity URLs. Content scripts are registered for the same supported pages.

### Data handling

- Prompts, targets, scraped text, citations, errors, settings, and run history
  remain in the Chrome profile's extension storage.
- The code contains no analytics client and no application-owned remote backend.
- The supported sites necessarily receive prompts that the extension submits
  through their browser interfaces.
- Export files are generated locally and handled according to the browser's
  download settings.

Before using the extension with confidential information, consider the privacy
policies and account settings of the supported engines as well as who can access
the local Chrome profile and exported files.

## 13. Architecture

```text
Extension action
    |
    v
Dashboard window (popup.html + popup.js)
    |  runtime messages / storage change events
    v
Background service worker (background.js)
    |  tab creation, navigation, injection, job polling
    v
Shared page helper (common.js) + one engine adapter
    |  visible DOM input and extraction
    v
Supported website page

Adapter result
    -> local target matching
    -> geoRun / geoHistory in chrome.storage.local
    -> dashboard summaries
    -> CSV or standalone HTML export
```

### Runtime messages

Dashboard-to-background messages:

| Message | Purpose |
| --- | --- |
| `START_BATCH_RUN` | Validate settings and begin a batch. |
| `CANCEL_BATCH_RUN` | Request cancellation and close temporary tabs. |
| `SCRAPE_ACTIVE_TAB` | Scrape the current supported tab. |
| `RUN_PROMPT_ACTIVE_TAB` | Run the first prompt in the current supported tab. |
| `GET_GEO_STATE` | Read run, history, and settings. |
| `SAVE_GEO_SETTINGS` | Persist form values. |
| `CLEAR_GEO_HISTORY` | Remove archived runs. |
| `RESET_EXTENSION_DATA` | Clear storage and reload. |

Background-to-content messages:

| Message | Purpose |
| --- | --- |
| `SCRAPE` | Return a scrape result immediately. |
| `RUN_PROMPT_START` | Start an asynchronous prompt job and return its ID. |
| `RUN_PROMPT_STATUS` | Poll an asynchronous prompt job. |

Adapters may also register compatibility handlers such as `RUN_PROMPT_SYNC` or
`RUN_PROMPT`, but the current background runner uses the start/status job flow.

## 14. Statuses and failures

Run statuses include `running`, `complete`, `cancelled`, and `failed`. Individual
adapter results normally use `ok`, plus engine-specific statuses such as
`no-answer-found`, `no-ai-overview`, and `ai-overview-empty`.

A job can fail because of:

- a signed-out or blocked session;
- a captcha or rate limit;
- a missing composer or submit control;
- a page-load timeout;
- an answer-generation timeout;
- an unsupported active-tab URL;
- a tab closed during execution; or
- a site markup change that prevents extraction.

Failed jobs are recorded in the run's `errors` array. The batch proceeds after
the configured retries are exhausted. A fatal runner failure marks the run
`failed` and archives it.

## 15. Troubleshooting

### The extension icon does not open the dashboard

Open `chrome://extensions`, confirm the extension is enabled, select **Reload**,
and inspect any error shown on the extension card.

### The active tab is reported as unsupported

Use a URL covered by the manifest: ChatGPT, a Google Search results page, or
Perplexity. Browser-internal pages such as `chrome://` cannot be scripted.

### A composer is not found

Confirm that the site is fully loaded and that the account can submit prompts.
Refresh the site and try **Run Active Tab** again. If the normal composer is
visible but the error persists, the site's markup has probably changed and the
adapter selectors need maintenance.

### The answer is empty or sources are missing

Open a completed answer on the affected site and use **Scrape Active Tab**.
Inspect `status` and `debug`, especially answer character count, source count,
matched labels, and selector/candidate details. Compare the live DOM with the
relevant adapter's selector lists.

### Google reports no AI Overview

This is often expected. AI Overview availability depends on the query, account,
region, and Google's product behavior. Confirm visually whether an overview is
present before treating it as an extraction problem.

### A long run stops updating

Keep the dashboard open, reduce batch size, increase the delay, and check for
captchas or signed-out background tabs. Chrome can suspend Manifest V3 service
workers. Since progress is stored after each job, completed partial results may
still be available for export.

### Mentions are false positives or false negatives

Review aliases and domains first. Remove overly broad aliases and add exact
business names or domains that appear in the output. Remember that matching is
text based and that source/activity checks use substring matching.

## 16. Maintainer guide

### Source responsibilities

| File | Responsibility |
| --- | --- |
| `manifest.json` | Metadata, permissions, background registration, host access, and automatic content-script registration. |
| `src/background.js` | Dashboard window management, parsing, target matching, tab lifecycle, retries, cancellation, runs, history, and message dispatch. |
| `src/common.js` | Shared DOM helpers, normalized payloads, job registry, persistence, and content-message routing. |
| `src/adapters/chatgpt.js` | ChatGPT selectors, prompt submission, completion detection, thinking-panel expansion, answer/source extraction. |
| `src/adapters/google-aio.js` | AI Overview candidate scoring, expansion, UI-text cleanup, answer extraction, and Google redirect normalization. |
| `src/adapters/perplexity.js` | Perplexity composer handling, answer wait logic, and answer/activity/source extraction. |
| `src/popup/popup.html` | Dashboard structure and styling. |
| `src/popup/popup.js` | Form state, rendering, summaries, actions, CSV creation, and report creation. |

### Updating selectors safely

1. Reproduce the issue on a fully loaded supported page.
2. Use **Scrape Active Tab** and retain its `debug` output.
3. Inspect the visible DOM and prefer stable semantic attributes such as
   `data-testid`, roles, and labels over generated class names.
4. Add a fallback rather than removing older selectors unless the old selector
   causes incorrect extraction.
5. Keep extraction scoped to the latest answer/overview so navigation and older
   conversation content are not captured.
6. Verify answer text, visible activity/reasoning, sources, status, and debug
   counts independently.
7. Test both manual scraping and prompt automation.

### Release checklist

Before publishing a revision:

1. Validate that `manifest.json` parses and all referenced scripts exist.
2. Search the repository for obsolete names, external assets, credentials, and
   personal paths.
3. Load the extension from a clean Chrome profile if possible.
4. Test the dashboard action, settings restoration, and one active-tab scrape.
5. Run at least one prompt on every supported engine.
6. Test a Google query both with and without an AI Overview.
7. Verify target matching in answer text and sources.
8. Exercise cancellation and at least one retryable failure.
9. Open the exported CSV in a spreadsheet and the HTML report in a browser.
10. Confirm that **Clear History** and **Refresh + Clear Data** behave as
    documented.
11. Update the manifest version and release notes when preparing a release.

## 17. Known limitations

- The extension depends on third-party website markup and behavior.
- Generated answers are nondeterministic and may differ by account, location,
  time, model, mode, or personalization.
- Only rendered content is available; hidden reasoning is intentionally out of
  scope.
- Prompt parsing treats commas as separators.
- Matching is lexical and can require careful aliases to represent an entity
  accurately.
- Runs are sequential and local to one Chrome profile.
- History is capped at 20 archived runs.
- Reports summarize mention presence, not sentiment, rank, prominence, citation
  quality, or factual accuracy.
- There is no scheduler, cloud synchronization, authentication layer, engine API
  integration, automated test suite, or selector-version service.

## 18. Responsible use

Use conservative run sizes and delays. Respect the supported sites' terms,
automated-access policies, account rules, rate limits, and applicable law. Review
generated and scraped content before sharing it, and do not treat visibility
percentages as a guarantee of stable placement or factual endorsement.
