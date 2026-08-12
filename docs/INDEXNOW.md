# IndexNow

[IndexNow](https://www.indexnow.org/) is a free, push-based protocol: instead of
waiting for search engines to re-crawl, you notify **Bing, Yandex**, and other
participating engines that URLs are new or updated, and they pick them up within
seconds. Because Bing's index feeds Copilot and ChatGPT search, faster Bing
indexing also means faster appearance in those AI answers.

OpenSEO exposes IndexNow through two MCP tools, so agents can close the
publish → index loop without leaving the chat, plus an **IndexNow** card in
**Project settings** for managing the key by hand.

> **Google does not participate in IndexNow.** Submitting notifies Bing,
> Yandex, Seznam, Naver, and Yep — a single submission is shared between them.
> Google indexing is unaffected and still relies on crawling / sitemaps. This
> catches people out, so the tool description says it too.

## How the key works

IndexNow proves you control a host by having you serve a **verification file**
(`<key>.txt`, containing the key) at the host root. The key itself is not a
secret, which is why OpenSEO stores it in the clear (`projects.indexnow_key`)
and shows it in project settings.

The key is per project, so each site keeps its own. A site that already
publishes a key file — from another tool, or an earlier install — can keep that
key: paste it instead of generating one, and the published file stays valid.

## Managing the key in the UI

**Project settings → IndexNow** (the project needs a domain first):

- **Generate key** — OpenSEO picks a 32-hex-char key and saves it.
- **Paste an existing key** — for a key file the site already serves. Accepted
  values are 8-128 characters of letters, numbers, and dashes (the protocol's
  own rule).
- **Replace key** — issues a new key. The file you already published stops
  matching, so publish the new one before submitting again.
- **Remove** — clears the key. `submit_urls_indexnow` then errors instead of
  submitting.

The card shows the exact URL the verification file has to resolve at, with copy
buttons for both the key and that URL.

## Tools

### `get_indexnow_key`

Returns `{ host, key, keyLocation, keyFileContent }` for a project (requires the
project to have a domain). Publish a file at `keyLocation` whose entire contents
are `keyFileContent`. Uses no credits.

The first call **generates and saves** a key if the project has none, so an
agent can set IndexNow up without a settings visit; later calls return that same
stored key and never replace it. Only the UI's Replace action issues a new one.

### `submit_urls_indexnow`

Submits up to 10,000 URLs to IndexNow for the project's host. URLs that aren't on
that host are skipped and reported (IndexNow only accepts same-host lists). The
verification file must already be live, or engines ignore the submission. Uses no
credits.

**Response contract.** The engine's HTTP status is returned as _data_
(`{ status, ok }`), not raised as a tool error — the call itself succeeded, the
engine just may not have accepted the list. `ok` tracks 2xx, so `202`
("accepted, key validation pending") is a success. A `403` means the key file
isn't published (or doesn't match) — the agent can read that and fix it. Only a
malformed request throws: no domain on the project, no IndexNow key yet, or no
submitted URL on the project's host.

| Status | Meaning                                                            |
| ------ | ------------------------------------------------------------------ |
| `200`  | Accepted                                                           |
| `202`  | Accepted, key validation pending (normal before the file is live)  |
| `400`  | Invalid format                                                     |
| `403`  | Key not valid — file missing or contents don't match               |
| `422`  | URLs don't belong to the host, or the key doesn't match the schema |
| `429`  | Too many requests                                                  |

## Setup (one time per project)

1. Ensure the project has a `domain`.
2. Get the key: **Project settings → IndexNow → Generate key**, or call
   `get_indexnow_key`. Both produce the same stored key.
3. Publish the file at `https://<domain>/<key>.txt`, containing only the key.
4. Verify it resolves: `curl https://<domain>/<key>.txt` returns the key.

## Usage

After publishing or updating pages, call `submit_urls_indexnow` with the affected
URLs. Re-run it whenever content changes — there's no cost and no rate concern for
normal volumes.
