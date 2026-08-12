import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import {
  BingApiError,
  BingNotConnectedError,
  BingTokenError,
} from "@/server/lib/bingErrors";
import {
  createBingClient,
  getBingSiteUrl,
  type BingCrawlIssue,
  type BingSite,
  type BingVisibility,
} from "@/server/lib/bingClient";
import { getBingWebmasterApiKey } from "@/server/features/bing/oauth-config";
import {
  BingConnectionRepository,
  type BingConnection,
} from "@/server/features/bing/repositories/BingConnectionRepository";
import { BING_API_KEY_ACCOUNT_ID, BING_OAUTH_PROVIDER_ID } from "@/shared/bing";

function isApiKeyAccount(accountId: string | null | undefined): boolean {
  return accountId === BING_API_KEY_ACCOUNT_ID;
}

async function listGrantsForUser(userId: string) {
  return db
    .select({ id: account.id, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, BING_OAUTH_PROVIDER_ID),
      ),
    );
}

async function createClient(input: {
  userId: string;
  accountId?: string | null;
}) {
  if (isApiKeyAccount(input.accountId)) {
    const apiKey = await getBingWebmasterApiKey();
    if (!apiKey) {
      throw new BingTokenError(
        "The Bing Webmaster API key is not configured on this deployment.",
      );
    }
    return createBingClient({ userId: input.userId, apiKey });
  }
  return createBingClient({
    userId: input.userId,
    ...(input.accountId ? { bingAccountId: input.accountId } : {}),
  });
}

/**
 * Expected ways a stored grant fails to reach Bing: no token could be minted,
 * or Bing rejected the call. These prompt a reconnect rather than logging as
 * an unexpected server fault.
 */
export function isExpectedGrantFailure(error: unknown): boolean {
  if (error instanceof BingTokenError) return true;
  return (
    error instanceof BingApiError &&
    (error.status === 401 || error.status === 403)
  );
}

/**
 * The connection for a project, scoped to the caller's organization. Reads go
 * through this rather than the repository so a project id from another org can
 * never resolve, even if a caller skipped its own authorization.
 */
async function requireConnection(
  organizationId: string,
  projectId: string,
): Promise<BingConnection> {
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  if (!connection || connection.organizationId !== organizationId) {
    throw new BingNotConnectedError(projectId);
  }
  return connection;
}

type BingConnectionStatus = {
  connected: boolean;
  siteUrl: string | null;
  usesApiKey: boolean;
  currentUserHasGrant: boolean;
  apiKeyConfigured: boolean;
};

async function getConnectionStatus(input: {
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<BingConnectionStatus> {
  const connection = await BingConnectionRepository.getByProjectId(
    input.projectId,
  );
  const scoped =
    connection && connection.organizationId === input.organizationId
      ? connection
      : null;
  const [grants, apiKey] = await Promise.all([
    listGrantsForUser(input.userId),
    getBingWebmasterApiKey(),
  ]);
  return {
    connected: Boolean(scoped),
    siteUrl: scoped?.siteUrl ?? null,
    usesApiKey: isApiKeyAccount(scoped?.bingAccountId),
    currentUserHasGrant: grants.length > 0,
    apiKeyConfigured: Boolean(apiKey),
  };
}

type BingSiteListResult = {
  accounts: Array<{
    accountId: string;
    requiresReconnect: boolean;
    sites: Array<{ siteUrl: string }>;
  }>;
};

/** The properties this user can pick from, per connected account. */
async function listSites(userId: string): Promise<BingSiteListResult> {
  const grants = await listGrantsForUser(userId);
  const accounts: BingSiteListResult["accounts"] = await Promise.all(
    grants.map(async (grant) => {
      try {
        const client = await createClient({
          userId,
          accountId: grant.accountId,
        });
        return {
          accountId: grant.accountId,
          requiresReconnect: false,
          sites: toSiteUrls(await client.listSites()),
        };
      } catch (error) {
        if (!isExpectedGrantFailure(error)) {
          console.error("Failed to list Bing Webmaster sites", error);
        }
        return {
          accountId: grant.accountId,
          requiresReconnect: true,
          sites: [],
        };
      }
    }),
  );

  // An API key creates no Better Auth account row, so it is presented as one
  // synthetic account and flows through the same property picker.
  if (accounts.length === 0 && (await getBingWebmasterApiKey())) {
    try {
      const client = await createClient({
        userId,
        accountId: BING_API_KEY_ACCOUNT_ID,
      });
      accounts.push({
        accountId: BING_API_KEY_ACCOUNT_ID,
        requiresReconnect: false,
        sites: toSiteUrls(await client.listSites()),
      });
    } catch (error) {
      if (!isExpectedGrantFailure(error)) {
        console.error("Failed to list Bing Webmaster API-key sites", error);
      }
      accounts.push({
        accountId: BING_API_KEY_ACCOUNT_ID,
        requiresReconnect: true,
        sites: [],
      });
    }
  }

  return { accounts };
}

function toSiteUrls(sites: BingSite[]): Array<{ siteUrl: string }> {
  return sites
    .map((site) => getBingSiteUrl(site))
    .filter((siteUrl): siteUrl is string => Boolean(siteUrl))
    .map((siteUrl) => ({ siteUrl }));
}

/** Maps a verified property to a project, after confirming the caller can see it. */
async function setSite(input: {
  organizationId: string;
  projectId: string;
  siteUrl: string;
  accountId: string;
  userId: string;
}): Promise<BingConnection> {
  const usesApiKey = isApiKeyAccount(input.accountId);
  const grants = await listGrantsForUser(input.userId);
  const hasGrant = grants.some((grant) => grant.accountId === input.accountId);
  if (!hasGrant && !(usesApiKey && (await getBingWebmasterApiKey()))) {
    throw new AppError(
      "NOT_FOUND",
      "That Microsoft account or Bing API key isn't connected to your OpenSEO account.",
    );
  }

  const client = await createClient({
    userId: input.userId,
    accountId: input.accountId,
  });
  const sites = await client.listSites();
  if (!sites.some((site) => getBingSiteUrl(site) === input.siteUrl)) {
    throw new AppError(
      "NOT_FOUND",
      "That Bing Webmaster property isn't available on the connected account.",
    );
  }

  return BingConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    siteUrl: input.siteUrl,
    connectedByUserId: input.userId,
    bingAccountId: input.accountId,
    connectedAccountEmail: null,
  });
}

async function disconnect(input: {
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<{ success: true }> {
  const connection = await BingConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection || connection.organizationId !== input.organizationId) {
    return { success: true };
  }
  await BingConnectionRepository.deleteByProjectId(input.projectId);

  // Drop the underlying grant only when this user owned it and no other
  // project still points at it — otherwise disconnecting one project would
  // break the others sharing that Microsoft account.
  if (
    connection.bingAccountId &&
    !isApiKeyAccount(connection.bingAccountId) &&
    connection.connectedByUserId === input.userId
  ) {
    const stillUsed = await BingConnectionRepository.existsForConnectorAccount(
      input.userId,
      connection.bingAccountId,
    );
    if (!stillUsed) {
      await db
        .delete(account)
        .where(
          and(
            eq(account.userId, input.userId),
            eq(account.providerId, BING_OAUTH_PROVIDER_ID),
            eq(account.accountId, connection.bingAccountId),
          ),
        );
    }
  }
  return { success: true };
}

async function getVisibility(input: {
  organizationId: string;
  projectId: string;
}): Promise<{ siteUrl: string; visibility: BingVisibility }> {
  const connection = await requireConnection(
    input.organizationId,
    input.projectId,
  );
  const client = await createClient({
    userId: connection.connectedByUserId,
    accountId: connection.bingAccountId,
  });
  return {
    siteUrl: connection.siteUrl,
    visibility: await client.getVisibility(connection.siteUrl),
  };
}

async function getCrawlIssues(input: {
  organizationId: string;
  projectId: string;
}): Promise<{ siteUrl: string; issues: BingCrawlIssue[] }> {
  const connection = await requireConnection(
    input.organizationId,
    input.projectId,
  );
  const client = await createClient({
    userId: connection.connectedByUserId,
    accountId: connection.bingAccountId,
  });
  return {
    siteUrl: connection.siteUrl,
    issues: await client.getCrawlIssues(connection.siteUrl),
  };
}

export const BingService = {
  getConnectionStatus,
  listSites,
  setSite,
  disconnect,
  getVisibility,
  getCrawlIssues,
} as const;
