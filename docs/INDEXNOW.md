# IndexNow

[IndexNow](https://www.indexnow.org/) is a free, push-based protocol: instead of
waiting for search engines to re-crawl, you notify **Bing, Yandex**, and other
participating engines that URLs are new or updated, and they pick them up within
seconds. Because Bing's index feeds Copilot and ChatGPT search, faster Bing
indexing also means faster appearance in those AI answers.

OpenSEO exposes it three ways: an **IndexNow** card in project settings (key
management), an **Indexing** page per project (submit URLs, see history), and
MCP tools so an agent can close the publish → index loop from chat. A deploy
webhook covers the fourth case — CI submitting automatically after a release.

> **Google does not participate in IndexNow.** Submitting notifies Bing,
> Yandex, Seznam, Naver, and Yep — a single submission is shared between them.
> Google indexing is unaffected and still relies on crawling / sitemaps. This
> catches people out, so the tool descriptions say it too.

## How the key works

IndexNow proves you control a host by having you serve a **verification file**
(`<key>.txt`, containing the key) on it. The key itself is not a secret, which
is why OpenSEO stores it in the clear (`indexnow_configs.key`) and shows it in
project settings.

The key is per project. A site that already publishes a key file — from another
tool, or an earlier install — can keep that key: paste it instead of generating
one, and the file you already published stays valid.

**The host always comes from the project's domain.** It is not stored
separately, so renaming a project's domain can never leave IndexNow submitting
for a host the project no longer tracks. A custom key location is allowed (the
protocol permits serving the file somewhere other than the root) but must be
HTTPS on that same host — this is enforced on save and re-checked before every
fetch, so "verify" can never be pointed at an internal address.

## Project settings → IndexNow

The project needs a domain first.

- **Generate key** — OpenSEO picks a 32-hex-char key and saves it.
- **Paste an existing key** — 8-128 characters of letters, numbers, and dashes
  (the protocol's own rule), validated as you type.
- **Check now** — fetches the verification file and confirms it contains the
  key. Until this passes, engines answer `403` to every submission, so the card
  shows an explicit "not checked yet" state rather than implying it works.
- **Submissions enabled** — pauses submissions without discarding the key.
- **Replace key** — issues a new key; the file you published stops matching, so
  publish the new one before submitting again.
- **Remove** — clears the key. The submission history is kept.

## Project → Indexing

- **Submit URLs** — one absolute URL per line, all on the project's host.
  Cross-host URLs are skipped and reported.
- **Deploy webhook** — see below.
- **History** — every submission and key check, with the engine's HTTP status,
  the number of attempts, and whether it came from the UI, an agent, or a
  webhook.

Submissions are sent in batches of 100 and retried up to three times on `429`,
`5xx`, and network failures. A `403` or `422` is **not** retried: those answers
will not change on a second attempt.

## War Room

`/war-room` is the workspace-wide view: which projects have IndexNow set up,
whether each key file is verified, submission totals, recent activity across all
projects, and live Bing crawl-issue counts. It answers "is anything broken
anywhere?" without opening each project.

## Deploy webhook

`POST /api/webhooks/indexnow/<projectId>`

Issue a secret on the project's Indexing page. It is shown once.

```bash
curl -X POST https://your-openseo/api/webhooks/indexnow/<projectId> \
  -H "X-IndexNow-Webhook-Secret: <secret>" \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com/changed-page"]}'
```

`Authorization: Bearer <secret>` works too. Accepted body shapes: `urls`,
`changedUrls`, or a single `url`. **With no body at all**, OpenSEO reads the
site's sitemap and submits what it lists — the "just deployed, work out what
changed" case.

Rules the endpoint enforces:

| Rule                                      | Behaviour                                                       |
| ----------------------------------------- | --------------------------------------------------------------- |
| Secret is **per project**                 | A leaked CI token can only submit for the project it belongs to |
| Wrong or missing secret                   | `404` — never `401`, so project ids can't be probed             |
| URLs off the project's host               | Silently skipped                                                |
| Private, loopback, or metadata hosts      | Rejected by the same URL policy the crawler uses                |
| Same URL submitted twice within 5 minutes | Deduped against the ledger                                      |
| Body over 64 KiB, or over 500 URLs        | `413` / `400`                                                   |
| IndexNow paused for the project           | `409`                                                           |

Rotating a secret invalidates the previous one immediately. There is no
instance-wide secret by design: one would let a single leaked token submit for
every project on the deployment.

## MCP tools

All four use no DataForSEO credits.

### `get_indexnow_key`

Returns `{ host, key, keyLocation, keyFileContent, enabled, lastVerifiedAt }`.
The first call **generates and saves** a key if the project has none, so an
agent can set IndexNow up without a settings visit; later calls return that same
stored key and never replace it. Only the UI's Replace action issues a new one.

### `verify_indexnow_key`

Fetches the verification file and reports whether it is live and matching, with
the reason when it isn't.

### `submit_urls_indexnow`

Submits up to 10,000 URLs for the project's host. Requires a key; the project
must not be paused.

**Response contract.** The engine's HTTP status is returned as _data_
(`{ status, ok }`), not raised as a tool error — the call itself succeeded, the
engine just may not have accepted the list. `ok` tracks 2xx, so `202`
("accepted, key validation pending") is a success. A `403` means the key file
isn't published (or doesn't match) — the agent can read that and fix it. Only a
malformed request throws: no domain, no key, IndexNow paused, or no submitted
URL on the project's host.

| Status | Meaning                                                            |
| ------ | ------------------------------------------------------------------ |
| `200`  | Accepted                                                           |
| `202`  | Accepted, key validation pending (normal before the file is live)  |
| `400`  | Invalid format                                                     |
| `403`  | Key not valid — file missing or contents don't match               |
| `422`  | URLs don't belong to the host, or the key doesn't match the schema |
| `429`  | Too many requests                                                  |

### `get_indexing_history`

Recent submissions and verifications with their statuses and source. Useful for
checking whether a URL was already submitted before resubmitting it.

## Setup (one time per project)

1. Ensure the project has a `domain`.
2. **Project settings → IndexNow → Generate key**, or call `get_indexnow_key`.
3. Publish the file at the shown location, containing only the key.
4. **Check now** (or `verify_indexnow_key`) until it reports the file is live.
5. Submit URLs from the Indexing page, an agent, or your deploy hook.
