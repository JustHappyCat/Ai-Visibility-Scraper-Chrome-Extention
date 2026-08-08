# Project Decisions

This log records decisions that affect multiple implementation workstreams.

## DEC-01 — License

Status: owner decision required

The recommended default is the MIT License. The repository must not be described
as open source or published as the first public release until the owner confirms
the license and copyright holder.

## DEC-02 — Project identity and security contact

Status: partially resolved

- Public name: GEO Visibility Scraper.
- Initial maturity: experimental beta.
- Security reports: use the hosting provider's private vulnerability-reporting
  feature. A public email address may be added later by the owner.
- Copyright holder: owner decision required.

## DEC-03 — Prompt input format

Status: accepted for version 0.3.0

Prompts are separated by new lines. Commas are treated as normal prompt content.
This avoids splitting natural-language prompts such as “compare cost, security,
and support.” A multi-line prompt cannot currently be entered as one job.

## DEC-04 — Result validity and visibility denominators

Status: accepted for version 0.3.0

Results are grouped into three categories:

- `success`: a supported answer surface was detected and extracted. These
  results are eligible for answer visibility percentages.
- `unavailable`: the page loaded successfully but the answer surface did not
  exist, for example `no-ai-overview`. These results contribute to an engine
  coverage metric but not the answer visibility denominator.
- `failure`: authentication, captcha, rate limit, navigation, automation, or
  extraction failed. These results count as failures and are excluded from both
  answer visibility and coverage success.

Reports must show totals for all three categories. No technical failure may be
silently converted into a non-mention.

## DEC-05 — Local storage budget

Status: accepted for version 0.3.0

- Soft extension-managed budget: 8 MiB of serialized data.
- Maximum history count: 20 runs.
- Prune oldest archived runs until both count and byte limits are satisfied.
- Keep the current run whenever possible.
- Do not duplicate a full run in `geoLast`; it should contain a compact status or
  the most recent standalone scrape result.
- Surface quota and pruning events in state that the dashboard can display.
