// IndexNow (https://www.indexnow.org/) — push-based (re)indexing that notifies
// Bing, Yandex, and other participating engines within seconds, for free.
//
// IndexNow keys are not secrets: control of a host is proven by serving
// `<key>.txt` (containing the key) at the host root. The key is stored per
// project (projects.indexnow_key) so a site that already publishes a key file —
// from another tool, or a previous OpenSEO install — can keep using it instead
// of having to republish a file OpenSEO picked.

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

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

export function indexNowKeyLocation(host: string, key: string): string {
  return `https://${host}/${key}.txt`;
}

// URLs must all belong to the host (IndexNow rejects cross-host lists).
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

type IndexNowSubmitResult = {
  submitted: number;
  status: number;
  ok: boolean;
  endpoint: string;
};

export async function submitToIndexNow(input: {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}): Promise<IndexNowSubmitResult> {
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
  return {
    submitted: input.urlList.length,
    status: response.status,
    // 200 = accepted; 202 = accepted, key validation pending.
    ok: response.status === 200 || response.status === 202,
    endpoint: INDEXNOW_ENDPOINT,
  };
}
