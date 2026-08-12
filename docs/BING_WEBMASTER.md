# Bing Webmaster

Connecting Bing Webmaster Tools gives OpenSEO two read-only signals per project:
**visibility** (impressions, clicks, average position) and **crawl issues**
(what Bing could not fetch or index). Bing's index is what Copilot and ChatGPT
search read, so this is the closest available read on AI-answer visibility —
and the natural companion to [IndexNow](./INDEXNOW.md), which pushes URLs into
that same index.

## Two ways to connect

**API key (simplest, recommended for self-hosting).** Bing Webmaster Tools →
Settings → API Access → generate a key, then set:

```
BING_WEBMASTER_API_KEY=...
```

One key serves the whole deployment. OpenSEO presents it in the property picker
as a single synthetic account, so the connect flow is the same as OAuth's. No
browser round trip is involved.

**Microsoft OAuth (per user).** Register an application on the Microsoft
identity platform with `https://<your-openseo>/api/bing/oauth/callback` as a
redirect URI, then set:

```
BING_CLIENT_ID=...
BING_CLIENT_SECRET=...
BETTER_AUTH_SECRET=...   # 32+ chars; encrypts the stored tokens
```

Tokens are stored in the Better Auth `account` table under providerId
`bing-webmaster`, the same way the Search Console and Analytics grants are, and
refreshed through Better Auth.

> The OAuth path was ported from the upstream contribution and its endpoints and
> scopes have **not** been exercised against a live Microsoft app in this fork.
> The API-key path has. If OAuth misbehaves, check the authorize/token URLs and
> scopes in `src/server/features/bing/selfHostedOAuth.ts` first.

## Connecting a project

**Project settings → Bing Webmaster → Connect**, then pick one of the verified
properties the account can see. One property per project; picking another
replaces it.

Disconnecting removes the project's property. If this user owned the underlying
OAuth grant and no other project still uses it, the grant is dropped too —
otherwise it stays, so disconnecting one project doesn't break the others
sharing that Microsoft account.

## MCP tools

Both are read-only and use no DataForSEO credits.

- **`get_bing_visibility`** — rank and traffic stats for the connected property.
- **`get_bing_crawl_issues`** — what Bing currently cannot crawl or index. Pair
  it with `submit_urls_indexnow` after a fix to get the page re-crawled quickly.

Bing's payloads vary in shape by endpoint and account, so both tools pass the
provider's rows through verbatim rather than reshaping them into a schema that
would quietly drop fields.

## War Room

`/war-room` lists crawl-issue counts for every connected project in the
workspace, with a sample of the issues and a clear "needs re-authorization"
state when a grant has expired. Bing is queried live, so the page caps how many
projects it fetches and says when it left some out.
