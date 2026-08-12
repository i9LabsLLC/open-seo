// IndexNow (https://www.indexnow.org/) — push-based (re)indexing that notifies
// Bing, Yandex, and other participating engines within seconds, for free.
//
// IndexNow keys are not secrets: control of a host is proven by serving
// `<key>.txt` (containing the key) at the host root. The key is stored per
// project so a site that already publishes a key file — from another tool, or
// an earlier install — can keep using it instead of republishing one we picked.

import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_MAX_URLS_PER_SUBMISSION,
} from "@/shared/indexnow";

// Bare host from a stored project domain (tolerates a scheme/path/trailing
// slash if one slipped in). Returns null when there's nothing usable.
export function indexNowHostFromDomain(
  domain: string | null | undefined,
): string | null {
  if (!domain) return null;
  const trimmed = domain.trim().replace(/^https?:\/\//i, "");
  const host = trimmed.split("/")[0]?.trim().toLowerCase();
  return host ? host : null;
}

// A fresh 32-hex-char key. Regenerating invalidates the published file, so the
// UI warns before replacing an existing key.
export function generateIndexNowKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function defaultIndexNowKeyLocation(host: string, key: string): string {
  return `https://${host}/${key}.txt`;
}

/**
 * A custom key location is only meaningful — and only safe to fetch — when it
 * is HTTPS on the project's own host. The protocol requires the same host, and
 * without that check "verify" would fetch any URL the user typed, turning the
 * verify button into a server-side request forgery primitive.
 */
export function isKeyLocationOnHost(
  keyLocation: string,
  host: string,
): boolean {
  try {
    const url = new URL(keyLocation);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}

/** URLs must all belong to the host (IndexNow rejects cross-host lists). */
export function partitionUrlsByHost(
  urls: string[],
  host: string,
): { matching: string[]; mismatched: string[] } {
  const matching: string[] = [];
  const mismatched: string[] = [];
  for (const url of urls) {
    let urlHost: string | null = null;
    try {
      urlHost = new URL(url).host.toLowerCase();
    } catch {
      urlHost = null;
    }
    if (urlHost && urlHost === host) {
      matching.push(url);
    } else {
      mismatched.push(url);
    }
  }
  return { matching, mismatched };
}

type IndexNowBatchResult = {
  status: number;
  ok: boolean;
  body: string;
};

/**
 * POSTs one batch and reports the engine's status as data. A non-2xx is not an
 * exception: the request was well formed and the engine simply declined it —
 * most often 403 because the key file isn't published yet — which callers and
 * agents need to see rather than have raised as a failure. Network failures
 * still throw, since there is no status to report.
 */
export async function submitIndexNowBatch(input: {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}): Promise<IndexNowBatchResult> {
  if (input.urlList.length > INDEXNOW_MAX_URLS_PER_SUBMISSION) {
    throw new Error(
      `IndexNow accepts at most ${INDEXNOW_MAX_URLS_PER_SUBMISSION} URLs per request.`,
    );
  }

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: input.host,
      key: input.key,
      keyLocation: input.keyLocation,
      urlList: input.urlList,
    }),
  });
  const body = await response.text().catch(() => "");

  return {
    status: response.status,
    // 200 = accepted; 202 = accepted, key validation pending.
    ok: response.status === 200 || response.status === 202,
    body,
  };
}
