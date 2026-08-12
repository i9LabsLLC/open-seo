import { beforeEach, describe, expect, it, vi } from "vitest";
import { BingApiError, BingTokenError } from "@/server/lib/bingErrors";

const mocks = vi.hoisted(() => ({
  getByProjectId: vi.fn(),
  upsert: vi.fn(),
  deleteByProjectId: vi.fn(),
  existsForConnectorAccount: vi.fn(),
  getBingWebmasterApiKey: vi.fn(),
  createBingClient: vi.fn(),
  select: vi.fn<() => Promise<Array<{ id: string; accountId: string }>>>(),
}));

// The schema barrel reaches for the Workers runtime binding; the service only
// needs the table objects, so a stub env is enough (mirrors GscService.test).
vi.mock("cloudflare:workers", () => ({ env: {} }));

vi.mock("@/server/features/bing/repositories/BingConnectionRepository", () => ({
  BingConnectionRepository: {
    getByProjectId: mocks.getByProjectId,
    upsert: mocks.upsert,
    deleteByProjectId: mocks.deleteByProjectId,
    existsForConnectorAccount: mocks.existsForConnectorAccount,
  },
}));

vi.mock("@/server/features/bing/oauth-config", () => ({
  getBingWebmasterApiKey: mocks.getBingWebmasterApiKey,
}));

vi.mock("@/server/lib/bingClient", () => ({
  createBingClient: mocks.createBingClient,
  getBingSiteUrl: (site: Record<string, unknown>) =>
    typeof site.siteUrl === "string" ? site.siteUrl : null,
}));

// The service only reads better-auth grants through this one query chain.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => mocks.select() }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
}));

import { BingNotConnectedError } from "@/server/lib/bingErrors";
import { BingService, isExpectedGrantFailure } from "./BingService";

const connection = (overrides: Record<string, unknown> = {}) => ({
  id: "conn_1",
  projectId: "project_1",
  organizationId: "org_1",
  siteUrl: "https://acme.com/",
  connectedByUserId: "user_1",
  bingAccountId: "account_1",
  connectedAccountEmail: null,
  ...overrides,
});

describe("BingService", () => {
  beforeEach(() => {
    mocks.select.mockResolvedValue([{ id: "a1", accountId: "account_1" }]);
    mocks.getBingWebmasterApiKey.mockResolvedValue(null);
    mocks.getByProjectId.mockResolvedValue(connection());
    mocks.createBingClient.mockReturnValue({
      listSites: vi.fn().mockResolvedValue([{ siteUrl: "https://acme.com/" }]),
      getVisibility: vi.fn().mockResolvedValue({ impressions: 10 }),
      getCrawlIssues: vi
        .fn()
        .mockResolvedValue([{ url: "https://acme.com/x" }]),
    });
  });

  // The connection row is keyed by project alone, so the org check is what
  // stops a project id from another workspace resolving here.
  it("treats another organization's connection as not connected", async () => {
    mocks.getByProjectId.mockResolvedValue(
      connection({ organizationId: "org_other" }),
    );

    await expect(
      BingService.getVisibility({
        organizationId: "org_1",
        projectId: "project_1",
      }),
    ).rejects.toBeInstanceOf(BingNotConnectedError);
  });

  it("refuses to bind a property the connected account cannot see", async () => {
    mocks.createBingClient.mockReturnValue({
      listSites: vi.fn().mockResolvedValue([{ siteUrl: "https://other.com/" }]),
    });

    await expect(
      BingService.setSite({
        organizationId: "org_1",
        projectId: "project_1",
        siteUrl: "https://acme.com/",
        accountId: "account_1",
        userId: "user_1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  // A deployment-wide API key has no better-auth account row; it still has to
  // reach the same picker, or self-hosters can never connect.
  it("offers the API key as a synthetic account when no grant exists", async () => {
    mocks.select.mockResolvedValue([]);
    mocks.getBingWebmasterApiKey.mockResolvedValue("test-key");

    const result = await BingService.listSites("user_1");

    expect(result.accounts).toEqual([
      {
        accountId: "api-key",
        requiresReconnect: false,
        sites: [{ siteUrl: "https://acme.com/" }],
      },
    ]);
  });

  it("marks an account that can no longer reach Bing as needing reconnect", async () => {
    mocks.createBingClient.mockReturnValue({
      listSites: vi.fn().mockRejectedValue(new BingApiError(403, "denied")),
    });

    const result = await BingService.listSites("user_1");

    expect(result.accounts[0]).toMatchObject({ requiresReconnect: true });
  });

  it("classifies revoked grants and denials as expected failures", () => {
    expect(isExpectedGrantFailure(new BingTokenError("revoked"))).toBe(true);
    expect(isExpectedGrantFailure(new BingApiError(401, "denied"))).toBe(true);
    expect(isExpectedGrantFailure(new BingApiError(500, "boom"))).toBe(false);
  });
});
