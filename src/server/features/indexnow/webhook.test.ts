import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getByProjectId: vi.fn(),
  listSucceededSince: vi.fn(),
  submitUrls: vi.fn(),
  getProjectById: vi.fn(),
  discoverUrls: vi.fn(),
}));

vi.mock(
  "@/server/features/indexnow/repositories/IndexNowConfigRepository",
  () => ({
    IndexNowConfigRepository: { getByProjectId: mocks.getByProjectId },
  }),
);

vi.mock(
  "@/server/features/indexnow/repositories/IndexingEventRepository",
  () => ({
    IndexingEventRepository: {
      listSucceededSince: mocks.listSucceededSince,
    },
  }),
);

vi.mock("@/server/features/indexnow/services/IndexNowService", () => ({
  IndexNowService: { submitUrls: mocks.submitUrls },
}));

vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: mocks.getProjectById },
}));

import { handleIndexNowWebhookRequest } from "./webhook";

const SECRET = "s3cret-webhook-value";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://app.example.com/api/webhooks/indexnow/project_1", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const authorized = (body: unknown) =>
  post(body, { "X-IndexNow-Webhook-Secret": SECRET });

describe("IndexNow deploy webhook", () => {
  beforeEach(() => {
    mocks.getByProjectId.mockResolvedValue({
      projectId: "project_1",
      organizationId: "org_1",
      webhookSecret: SECRET,
      enabled: true,
    });
    mocks.getProjectById.mockResolvedValue({
      id: "project_1",
      domain: "acme.com",
    });
    mocks.listSucceededSince.mockResolvedValue([]);
    mocks.submitUrls.mockResolvedValue({
      submitted: 1,
      failed: 0,
      status: 200,
      skipped: [],
    });
    mocks.discoverUrls.mockResolvedValue({ urls: [], blocked: false });
  });

  // 404 rather than 401: a distinguishable "wrong secret" would confirm which
  // project ids exist on the instance.
  it("answers 404 and submits nothing for a wrong secret", async () => {
    const response = await handleIndexNowWebhookRequest(
      post(
        { urls: ["https://acme.com/a"] },
        {
          "X-IndexNow-Webhook-Secret": "not-the-secret",
        },
      ),
      "project_1",
      { discoverUrls: mocks.discoverUrls, now: () => 0 },
    );

    expect(response.status).toBe(404);
    expect(mocks.submitUrls).not.toHaveBeenCalled();
  });

  it("answers 404 when the project has no secret issued", async () => {
    mocks.getByProjectId.mockResolvedValue({
      projectId: "project_1",
      organizationId: "org_1",
      webhookSecret: null,
      enabled: true,
    });

    const response = await handleIndexNowWebhookRequest(
      authorized({ urls: ["https://acme.com/a"] }),
      "project_1",
      { discoverUrls: mocks.discoverUrls, now: () => 0 },
    );

    expect(response.status).toBe(404);
    expect(mocks.submitUrls).not.toHaveBeenCalled();
  });

  it("submits only URLs on the project's own host", async () => {
    await handleIndexNowWebhookRequest(
      authorized({
        urls: [
          "https://acme.com/a",
          "https://attacker.example/b",
          "http://127.0.0.1/admin",
        ],
      }),
      "project_1",
      { discoverUrls: mocks.discoverUrls, now: () => 0 },
    );

    expect(mocks.submitUrls).toHaveBeenCalledWith("org_1", {
      projectId: "project_1",
      urls: ["https://acme.com/a"],
      source: "webhook",
    });
  });

  it("drops URLs already submitted inside the dedupe window", async () => {
    mocks.listSucceededSince.mockResolvedValue(["https://acme.com/a"]);

    const response = await handleIndexNowWebhookRequest(
      authorized({ urls: ["https://acme.com/a", "https://acme.com/b"] }),
      "project_1",
      { discoverUrls: mocks.discoverUrls, now: () => 1_000_000 },
    );

    expect(mocks.submitUrls).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ urls: ["https://acme.com/b"] }),
    );
    await expect(response.json()).resolves.toMatchObject({ deduped: 1 });
  });

  // An empty body is the "just deployed, work out what changed" case.
  it("falls back to sitemap discovery when no URLs are posted", async () => {
    mocks.discoverUrls.mockResolvedValue({
      urls: ["https://acme.com/", "https://acme.com/pricing"],
      blocked: false,
    });

    await handleIndexNowWebhookRequest(
      post(undefined, {
        "X-IndexNow-Webhook-Secret": SECRET,
      }),
      "project_1",
      {
        discoverUrls: mocks.discoverUrls,
        now: () => 0,
      },
    );

    expect(mocks.submitUrls).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        urls: ["https://acme.com/", "https://acme.com/pricing"],
      }),
    );
  });

  it("refuses while IndexNow is paused for the project", async () => {
    mocks.getByProjectId.mockResolvedValue({
      projectId: "project_1",
      organizationId: "org_1",
      webhookSecret: SECRET,
      enabled: false,
    });

    const response = await handleIndexNowWebhookRequest(
      authorized({ urls: ["https://acme.com/a"] }),
      "project_1",
      { discoverUrls: mocks.discoverUrls, now: () => 0 },
    );

    expect(response.status).toBe(409);
    expect(mocks.submitUrls).not.toHaveBeenCalled();
  });
});
