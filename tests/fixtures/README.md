# Adapter fixture convention

Fixtures are minimal, synthetic or aggressively sanitized DOM fragments used to
exercise an adapter selector or status path without a live account.

Create fixtures under an engine directory (`chatgpt`, `google-aio`, or
`perplexity`) as a pair with the same basename:

```text
tests/fixtures/<engine>/<scenario>.case.json
tests/fixtures/<engine>/<scenario>.fragment.html
```

Copy the files in `_template/` when adding a scenario. Keep only markup needed
for the behavior under test. Never include a full page, account details, actual
prompts, cookies, request headers, authentication tokens, tracking parameters,
or private generated answers. Prefer unmistakably fictional text and
`example.com` URLs.

Every selector regression must include a fixture. The metadata records the
observed page state and expected adapter result; the HTML remains input only.
CI validates every registered pair before adapter assertions run.
