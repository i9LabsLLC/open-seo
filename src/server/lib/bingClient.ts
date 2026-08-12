import { getAuth } from "@/lib/auth";
import { BingApiError, BingTokenError } from "@/server/lib/bingErrors";
import { BING_OAUTH_PROVIDER_ID } from "@/shared/bing";

// Bing's Webmaster API is the legacy OData-flavoured service; responses wrap
// their payload in `d`, and collections sometimes in `d.results`.
const BING_API_BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export type BingSite = Record<string, unknown>;
export type BingCrawlIssue = Record<string, unknown>;
export type BingVisibility = Record<string, unknown> | unknown[];

function messageForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "Bing Webmaster denied access to this property (no verified permission, or the connection was revoked).";
  }
  if (status === 429)
    return "Bing Webmaster rate limit reached. Retry shortly.";
  if (status === 404) {
    return "Bing Webmaster property not found. It may have been removed from Bing Webmaster Tools.";
  }
  return `Bing Webmaster API error (${status}): ${body.slice(0, 300)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  return record;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Strips the OData transport envelope, leaving provider fields verbatim. */
function unwrapResponse(value: unknown): unknown {
  const root = asRecord(value);
  const data = root && "d" in root ? root.d : value;
  const record = asRecord(data);
  if (!record) return data;
  if (isUnknownArray(record.results)) return record.results;
  if (isUnknownArray(record.value)) return record.value;
  return data;
}

/** Bing spells the site URL differently across endpoints. */
export function getBingSiteUrl(site: BingSite): string | null {
  for (const key of ["siteUrl", "url", "Url", "SiteUrl"]) {
    const value = site[key];
    if (typeof value === "string") return value;
  }
  return null;
}

export function createBingClient(opts: {
  userId?: string;
  bingAccountId?: string;
  apiKey?: string;
}) {
  async function getToken(): Promise<string> {
    if (!opts.userId) {
      throw new BingTokenError(
        "No Bing Webmaster OAuth user is configured for this connection.",
      );
    }
    let result: { accessToken?: string } | undefined;
    try {
      result = await getAuth().api.getAccessToken({
        body: {
          providerId: BING_OAUTH_PROVIDER_ID,
          userId: opts.userId,
          ...(opts.bingAccountId ? { accountId: opts.bingAccountId } : {}),
        },
      });
    } catch (error) {
      throw new BingTokenError(
        "Could not mint a Bing Webmaster access token (grant revoked or expired).",
        error,
      );
    }
    if (!result?.accessToken) {
      throw new BingTokenError(
        "Bing Webmaster returned no access token (grant revoked or expired).",
      );
    }
    return result.accessToken;
  }

  async function request(
    endpoint: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    const url = new URL(`${BING_API_BASE}/${endpoint}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.apiKey) {
      // The API-key flow is what Bing documents for server-to-server use, and
      // it wants the key in the query string. It is never echoed back to
      // callers — only the response payload is returned.
      url.searchParams.set("apikey", opts.apiKey);
    } else {
      headers.Authorization = `Bearer ${await getToken()}`;
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new BingApiError(
        response.status,
        messageForStatus(response.status, body),
        body,
      );
    }
    return unwrapResponse(await response.json());
  }

  return {
    /** `GetUserSites` — the properties this grant can see. */
    async listSites(): Promise<BingSite[]> {
      const data = await request("GetUserSites");
      if (!isUnknownArray(data)) return [];
      return data.filter((site): site is BingSite => asRecord(site) !== null);
    },

    /** `GetRankAndTrafficStats` — impressions and clicks over time. */
    async getVisibility(siteUrl: string): Promise<BingVisibility> {
      const data = await request("GetRankAndTrafficStats", { siteUrl });
      if (isUnknownArray(data)) return data;
      return asRecord(data) ?? {};
    },

    /** `GetCrawlIssues` — what Bing could not fetch or index. */
    async getCrawlIssues(siteUrl: string): Promise<BingCrawlIssue[]> {
      const data = await request("GetCrawlIssues", { siteUrl });
      if (!isUnknownArray(data)) return [];
      return data.filter(
        (issue): issue is BingCrawlIssue => asRecord(issue) !== null,
      );
    },
  };
}
