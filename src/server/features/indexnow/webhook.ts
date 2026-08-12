import { IndexNowConfigRepository } from "@/server/features/indexnow/repositories/IndexNowConfigRepository";
import { IndexingEventRepository } from "@/server/features/indexnow/repositories/IndexingEventRepository";
import { IndexNowService } from "@/server/features/indexnow/services/IndexNowService";
import { indexNowHostFromDomain } from "@/server/lib/indexnow";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { discoverSiteUrls } from "@/server/lib/scrape";
import { isCrawlableUrl } from "@/server/lib/audit/url-policy";

// A deploy hook posts a small JSON body, or nothing at all when it wants the
// sitemap walked instead. These bounds keep an unauthenticated request cheap to
// reject and an authenticated one from turning into an unbounded crawl.
const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
const WEBHOOK_MAX_URLS = 500;
// Re-submitting the same URL minutes apart tells engines nothing new, and a CI
// pipeline that fires the hook per matrix job would do exactly that.
const WEBHOOK_DEDUPE_WINDOW_MS = 5 * 60 * 1_000;

const MAX_URL_LENGTH = 2_048;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Array.isArray widens to any[]; this keeps the payload's entries unknown until
// each one is checked.
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Compares two secrets without leaking their length or first differing byte
 * through timing. Digesting first makes the comparison fixed-width.
 */
async function secretsMatch(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function presentedSecrets(request: Request): string[] {
  const values: string[] = [];
  const header = request.headers.get("x-indexnow-webhook-secret");
  if (header) values.push(header);
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    values.push(authorization.slice("Bearer ".length));
  }
  return values;
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    // Rejects private, loopback, and cloud-metadata hosts — the same policy the
    // crawler uses, so a webhook cannot be used to probe the internal network.
    !isCrawlableUrl(parsed.toString())
  ) {
    return null;
  }

  parsed.hash = "";
  return parsed.toString();
}

/** URLs from the payload, deduped and restricted to the project's own host. */
function urlsForHost(raw: string[], host: string): string[] {
  const unique = new Set<string>();
  for (const value of raw) {
    const url = normalizeUrl(value);
    if (!url) continue;
    if (new URL(url).host.toLowerCase() !== host) continue;
    unique.add(url);
  }
  return Array.from(unique);
}

type ParsedBody =
  | { ok: true; urls: string[]; hasUrls: boolean }
  | { ok: false; response: Response };

async function parseBody(request: Request): Promise<ParsedBody> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    Number.parseInt(contentLength, 10) > WEBHOOK_MAX_BODY_BYTES
  ) {
    return {
      ok: false,
      response: jsonResponse({ error: "Payload is too large." }, 413),
    };
  }

  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: "Unable to read the payload." }, 400),
    };
  }
  if (body.byteLength > WEBHOOK_MAX_BODY_BYTES) {
    return {
      ok: false,
      response: jsonResponse({ error: "Payload is too large." }, 413),
    };
  }
  // No body means "figure out what changed" — the sitemap walk below.
  if (body.byteLength === 0) return { ok: true, urls: [], hasUrls: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: "Payload must be valid JSON." }, 400),
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      response: jsonResponse({ error: "Payload must be a JSON object." }, 400),
    };
  }

  const values: unknown[] = [];
  for (const key of ["urls", "changedUrls"]) {
    const value = parsed[key];
    if (value === undefined) continue;
    if (!isUnknownArray(value)) {
      return {
        ok: false,
        response: jsonResponse({ error: `"${key}" must be an array.` }, 400),
      };
    }
    values.push(...value);
  }
  if (values.length === 0 && parsed.url !== undefined) values.push(parsed.url);

  if (values.length > WEBHOOK_MAX_URLS) {
    return {
      ok: false,
      response: jsonResponse(
        { error: `At most ${WEBHOOK_MAX_URLS} URLs per call.` },
        400,
      ),
    };
  }

  const urls: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      return {
        ok: false,
        response: jsonResponse({ error: "URLs must be strings." }, 400),
      };
    }
    urls.push(value);
  }
  return { ok: true, urls, hasUrls: urls.length > 0 };
}

type IndexNowWebhookDependencies = {
  discoverUrls: (
    host: string,
    limit: number,
  ) => Promise<{ urls: string[]; blocked: boolean }>;
  now: () => number;
};

const defaultDependencies: IndexNowWebhookDependencies = {
  discoverUrls: (host, limit) => discoverSiteUrls(host, limit),
  now: () => Date.now(),
};

/**
 * Deploy hook: submits the posted URLs (or, with no body, what the site's
 * sitemap lists) to IndexNow for ONE project.
 *
 * Authorization is the project's own webhook secret, so a leaked CI token can
 * only ever touch the project it was issued for — and the response says nothing
 * about any other project. The endpoint answers 404 for both "no such project"
 * and "wrong secret", so it cannot be used to enumerate project ids.
 */
export async function handleIndexNowWebhookRequest(
  request: Request,
  projectId: string,
  dependencies: Partial<IndexNowWebhookDependencies> = {},
): Promise<Response> {
  const { discoverUrls, now } = { ...defaultDependencies, ...dependencies };

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const config = await IndexNowConfigRepository.getByProjectId(projectId);
  const presented = presentedSecrets(request);
  if (!config?.webhookSecret || presented.length === 0) {
    return jsonResponse({ error: "Not found." }, 404);
  }

  let authorized = false;
  for (const value of presented) {
    if (await secretsMatch(config.webhookSecret, value)) authorized = true;
  }
  if (!authorized) return jsonResponse({ error: "Not found." }, 404);

  if (!config.enabled) {
    return jsonResponse({ error: "IndexNow is paused for this project." }, 409);
  }

  const project = await ProjectRepository.getProjectById(projectId);
  const host = indexNowHostFromDomain(project?.domain);
  if (!host) {
    return jsonResponse({ error: "This project has no domain set." }, 409);
  }

  const parsed = await parseBody(request);
  if (!parsed.ok) return parsed.response;

  let candidates: string[];
  if (parsed.hasUrls) {
    candidates = urlsForHost(parsed.urls, host);
  } else {
    const discovered = await discoverUrls(host, WEBHOOK_MAX_URLS);
    candidates = discovered.blocked ? [] : urlsForHost(discovered.urls, host);
  }
  candidates = candidates.slice(0, WEBHOOK_MAX_URLS);

  if (candidates.length === 0) {
    return jsonResponse({
      accepted: true,
      submitted: 0,
      failed: 0,
      deduped: 0,
    });
  }

  const since = new Date(now() - WEBHOOK_DEDUPE_WINDOW_MS).toISOString();
  const recent = new Set(
    await IndexingEventRepository.listSucceededSince(projectId, since),
  );
  const fresh = candidates.filter((url) => !recent.has(url));
  const deduped = candidates.length - fresh.length;

  if (fresh.length === 0) {
    return jsonResponse({ accepted: true, submitted: 0, failed: 0, deduped });
  }

  const result = await IndexNowService.submitUrls(config.organizationId, {
    projectId,
    urls: fresh,
    source: "webhook",
  });

  return jsonResponse({
    accepted: true,
    submitted: result.submitted,
    failed: result.failed,
    deduped,
    status: result.status,
  });
}
