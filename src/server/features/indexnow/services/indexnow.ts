import { ProjectService } from "@/server/features/projects/services/ProjectService";
import {
  IndexNowConfigRepository,
  type IndexNowConfigRecord,
} from "@/server/features/indexnow/repositories/IndexNowConfigRepository";
import {
  IndexingEventRepository,
  type IndexingEventRecord,
} from "@/server/features/indexnow/repositories/IndexingEventRepository";
import { AppError } from "@/server/lib/errors";
import {
  defaultIndexNowKeyLocation,
  generateIndexNowKey,
  indexNowHostFromDomain,
  isKeyLocationOnHost,
  partitionUrlsByHost,
  submitIndexNowBatch,
} from "@/server/lib/indexnow";
import {
  INDEXNOW_BATCH_SIZE,
  INDEXNOW_KEY_RULE,
  INDEXNOW_MAX_ATTEMPTS,
  INDEXNOW_RETRY_DELAYS_MS,
  isValidIndexNowKey,
  type IndexingEventSource,
} from "@/shared/indexnow";

const MAX_RESPONSE_BODY_LENGTH = 1_000;

const DOMAIN_REQUIRED_MESSAGE =
  "This project has no domain set. Add a domain to the project first, then retry.";
const KEY_REQUIRED_MESSAGE =
  "This project has no IndexNow key yet. Generate one in project settings (or with get_indexnow_key), publish the verification file, then retry.";

/** The config plus everything derived from the project it belongs to. */
type IndexNowSetup = {
  projectId: string;
  organizationId: string;
  host: string;
  key: string;
  keyLocation: string;
  enabled: boolean;
  lastVerifiedAt: string | null;
  hasWebhookSecret: boolean;
};

function truncate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, MAX_RESPONSE_BODY_LENGTH);
}

function chunk<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * The project's host, which every other operation is scoped to. Derived from
 * the project rather than stored, so renaming a project's domain can never
 * leave IndexNow submitting for the old one. Resolving the project through the
 * service is also the authorization gate: it 404s outside the organization.
 */
async function resolveHost(organizationId: string, projectId: string) {
  const project = await ProjectService.getProjectForOrganization(
    organizationId,
    projectId,
  );
  return indexNowHostFromDomain(project.domain);
}

async function requireHost(organizationId: string, projectId: string) {
  const host = await resolveHost(organizationId, projectId);
  if (!host) throw new AppError("VALIDATION_ERROR", DOMAIN_REQUIRED_MESSAGE);
  return host;
}

function toSetup(config: IndexNowConfigRecord, host: string): IndexNowSetup {
  return {
    projectId: config.projectId,
    organizationId: config.organizationId,
    host,
    key: config.key,
    // A stored location that no longer matches the project's host (the domain
    // changed after it was saved) falls back to the default rather than being
    // used, so nothing ever fetches or advertises another host.
    keyLocation:
      config.keyLocation && isKeyLocationOnHost(config.keyLocation, host)
        ? config.keyLocation
        : defaultIndexNowKeyLocation(host, config.key),
    enabled: config.enabled,
    lastVerifiedAt: config.lastVerifiedAt,
    hasWebhookSecret: Boolean(config.webhookSecret),
  };
}

/**
 * Everything the UI needs to render the feature: the project's host (null when
 * it has no domain yet, which is a setup step rather than an error) and the
 * saved config, if any.
 */
type IndexNowState = {
  host: string | null;
  setup: IndexNowSetup | null;
};

export async function getState(
  organizationId: string,
  projectId: string,
): Promise<IndexNowState> {
  const host = await resolveHost(organizationId, projectId);
  const config = await IndexNowConfigRepository.getByProjectId(projectId);
  if (!host || !config || config.organizationId !== organizationId) {
    return { host, setup: null };
  }
  return { host, setup: toSetup(config, host) };
}

async function requireSetup(organizationId: string, projectId: string) {
  const host = await requireHost(organizationId, projectId);
  const config = await IndexNowConfigRepository.getByProjectId(projectId);
  if (!config || config.organizationId !== organizationId) {
    throw new AppError("VALIDATION_ERROR", KEY_REQUIRED_MESSAGE);
  }
  return toSetup(config, host);
}

/**
 * Saves a key the user pasted or generated. A custom key location must be
 * HTTPS on the project's own host — the protocol requires it, and it keeps
 * `verifyKey` from being pointed at an arbitrary URL.
 */
export async function saveKey(
  organizationId: string,
  input: { projectId: string; key: string; keyLocation?: string | null },
): Promise<IndexNowSetup> {
  const host = await requireHost(organizationId, input.projectId);
  const key = input.key.trim();
  if (!isValidIndexNowKey(key)) {
    throw new AppError("VALIDATION_ERROR", INDEXNOW_KEY_RULE);
  }

  const keyLocation = input.keyLocation?.trim() || null;
  if (keyLocation && !isKeyLocationOnHost(keyLocation, host)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `The key file has to be served over HTTPS on ${host}.`,
    );
  }

  const config = await IndexNowConfigRepository.upsertKey({
    projectId: input.projectId,
    organizationId,
    key,
    keyLocation,
  });
  return toSetup(config, host);
}

export async function generateKey(
  organizationId: string,
  input: { projectId: string },
): Promise<IndexNowSetup> {
  return saveKey(organizationId, {
    projectId: input.projectId,
    key: generateIndexNowKey(),
    keyLocation: null,
  });
}

/**
 * The project's key, provisioning one on first use so an agent can set
 * IndexNow up without a settings visit. Never replaces an existing key: the
 * user may already have published its file.
 */
export async function ensureKey(
  organizationId: string,
  projectId: string,
): Promise<IndexNowSetup> {
  const { setup } = await getState(organizationId, projectId);
  if (setup) return setup;
  return generateKey(organizationId, { projectId });
}

export async function setEnabled(
  organizationId: string,
  input: { projectId: string; enabled: boolean },
): Promise<IndexNowSetup> {
  const setup = await requireSetup(organizationId, input.projectId);
  const config = await IndexNowConfigRepository.setEnabled(
    input.projectId,
    input.enabled,
  );
  return config ? toSetup(config, setup.host) : setup;
}

/**
 * Issues a deploy-webhook secret for this project and returns it once. The
 * secret is per project on purpose: a single instance-wide secret would let one
 * leaked CI token submit URLs for every project on the deployment.
 */
export async function rotateWebhookSecret(
  organizationId: string,
  input: { projectId: string },
): Promise<{ secret: string }> {
  await requireSetup(organizationId, input.projectId);
  const secret = crypto.randomUUID().replaceAll("-", "");
  await IndexNowConfigRepository.setWebhookSecret(input.projectId, secret);
  return { secret };
}

export async function revokeWebhookSecret(
  organizationId: string,
  input: { projectId: string },
): Promise<{ success: true }> {
  await requireSetup(organizationId, input.projectId);
  await IndexNowConfigRepository.setWebhookSecret(input.projectId, null);
  return { success: true };
}

export async function removeKey(
  organizationId: string,
  input: { projectId: string },
): Promise<{ success: true }> {
  await IndexNowConfigRepository.deleteByProjectId(
    input.projectId,
    organizationId,
  );
  return { success: true };
}

type VerifyKeyResult = {
  verified: boolean;
  keyLocation: string;
  status: number | null;
  detail: string;
};

/**
 * Fetches the key file and checks it contains the key. The location is always
 * HTTPS on the project's own host (enforced on save, re-checked here), so this
 * cannot be aimed at internal addresses.
 */
export async function verifyKey(
  organizationId: string,
  input: { projectId: string },
): Promise<VerifyKeyResult> {
  const setup = await requireSetup(organizationId, input.projectId);
  const [event] = await IndexingEventRepository.insertPending({
    projectId: setup.projectId,
    organizationId: setup.organizationId,
    urls: [setup.keyLocation],
    eventType: "verified",
    source: "ui",
  });

  const finish = async (result: VerifyKeyResult): Promise<VerifyKeyResult> => {
    if (event) {
      await IndexingEventRepository.markResult([event.id], {
        eventType: result.verified ? "verified" : "failed",
        status: result.verified ? "success" : "error",
        httpStatus: result.status,
        responseBody: truncate(result.detail),
        attempts: 1,
      });
    }
    await IndexNowConfigRepository.markVerified(
      setup.projectId,
      result.verified ? new Date().toISOString() : null,
    );
    return result;
  };

  try {
    const response = await fetch(setup.keyLocation, { method: "GET" });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      return finish({
        verified: false,
        keyLocation: setup.keyLocation,
        status: response.status,
        detail: `The key file returned HTTP ${response.status}.`,
      });
    }
    if (body.trim() !== setup.key) {
      return finish({
        verified: false,
        keyLocation: setup.keyLocation,
        status: response.status,
        detail: "The key file does not contain this project's key.",
      });
    }
    return finish({
      verified: true,
      keyLocation: setup.keyLocation,
      status: response.status,
      detail: "The key file is live and matches.",
    });
  } catch (error) {
    return finish({
      verified: false,
      keyLocation: setup.keyLocation,
      status: null,
      detail:
        error instanceof Error
          ? `Could not reach the key file: ${error.message}`
          : "Could not reach the key file.",
    });
  }
}

type SubmitUrlsResult = {
  host: string;
  submitted: number;
  failed: number;
  skipped: string[];
  keyLocation: string;
  // The last batch's engine status, which is what a single-batch caller (the
  // common case) wants to see. Null when nothing was submitted.
  status: number | null;
  ok: boolean;
};

/**
 * Submits URLs in batches, recording every attempt in the ledger. Batches are
 * retried on 429/5xx and network errors; a batch that still fails is recorded
 * as an error and the run continues, so one bad batch cannot lose the rest.
 */
export async function submitUrls(
  organizationId: string,
  input: {
    projectId: string;
    urls: string[];
    source: IndexingEventSource;
  },
): Promise<SubmitUrlsResult> {
  const setup = await requireSetup(organizationId, input.projectId);
  if (!setup.enabled) {
    throw new AppError(
      "VALIDATION_ERROR",
      "IndexNow is paused for this project. Re-enable it in project settings.",
    );
  }

  const { matching, mismatched } = partitionUrlsByHost(input.urls, setup.host);
  if (matching.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      `None of the submitted URLs are on ${setup.host}. IndexNow only accepts URLs for the project's own host.`,
    );
  }

  let submitted = 0;
  let failed = 0;
  let lastStatus: number | null = null;
  let lastOk = false;

  for (const batch of chunk(matching, INDEXNOW_BATCH_SIZE)) {
    const events = await IndexingEventRepository.insertPending({
      projectId: setup.projectId,
      organizationId: setup.organizationId,
      urls: batch,
      eventType: "submitted",
      source: input.source,
    });
    const ids = events.map((event) => event.id);

    let status: number | null = null;
    let detail: string | null = null;
    let ok = false;
    let attempts = 0;

    for (let attempt = 0; attempt < INDEXNOW_MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt + 1;
      let retryable = false;
      try {
        const result = await submitIndexNowBatch({
          host: setup.host,
          key: setup.key,
          keyLocation: setup.keyLocation,
          urlList: batch,
        });
        status = result.status;
        detail = result.body;
        ok = result.ok;
        // A rejection the engine will answer the same way next time (403 for a
        // missing key file, 422 for bad URLs) is final; only congestion and
        // engine faults are worth another attempt.
        retryable = !ok && (result.status === 429 || result.status >= 500);
      } catch (error) {
        status = null;
        detail = error instanceof Error ? error.message : String(error);
        ok = false;
        retryable = true;
      }

      if (ok || !retryable) break;
      const delay = INDEXNOW_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }

    await IndexingEventRepository.markResult(ids, {
      eventType: ok ? "submitted" : "failed",
      status: ok ? "success" : "error",
      httpStatus: status,
      responseBody: truncate(detail),
      attempts,
    });

    if (ok) submitted += batch.length;
    else failed += batch.length;
    lastStatus = status;
    lastOk = ok;
  }

  return {
    host: setup.host,
    submitted,
    failed,
    skipped: mismatched,
    keyLocation: setup.keyLocation,
    status: lastStatus,
    ok: lastOk,
  };
}

export async function listEvents(
  organizationId: string,
  input: { projectId: string; limit?: number; offset?: number },
): Promise<IndexingEventRecord[]> {
  // Scopes the read to the caller's organization; the repository is keyed by
  // project alone.
  await requireHost(organizationId, input.projectId);
  return IndexingEventRepository.listByProjectId(input.projectId, {
    limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
    offset: input.offset,
  });
}
