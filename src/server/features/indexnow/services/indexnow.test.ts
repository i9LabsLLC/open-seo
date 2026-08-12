import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  getByProjectId: vi.fn(),
  upsertKey: vi.fn(),
  setEnabled: vi.fn(),
  setWebhookSecret: vi.fn(),
  markVerified: vi.fn(),
  deleteByProjectId: vi.fn(),
  insertPending: vi.fn(),
  markResult: vi.fn(),
  listByProjectId: vi.fn(),
  listSucceededSince: vi.fn(),
}));

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

vi.mock(
  "@/server/features/indexnow/repositories/IndexNowConfigRepository",
  () => ({
    IndexNowConfigRepository: {
      getByProjectId: mocks.getByProjectId,
      upsertKey: mocks.upsertKey,
      setEnabled: mocks.setEnabled,
      setWebhookSecret: mocks.setWebhookSecret,
      markVerified: mocks.markVerified,
      deleteByProjectId: mocks.deleteByProjectId,
    },
  }),
);

vi.mock(
  "@/server/features/indexnow/repositories/IndexingEventRepository",
  () => ({
    IndexingEventRepository: {
      insertPending: mocks.insertPending,
      markResult: mocks.markResult,
      listByProjectId: mocks.listByProjectId,
      listSucceededSince: mocks.listSucceededSince,
    },
  }),
);

import {
  ensureKey,
  getState,
  saveKey,
  submitUrls,
  verifyKey,
} from "./indexnow";

const config = (overrides: Record<string, unknown> = {}) => ({
  id: "config_1",
  projectId: "project_1",
  organizationId: "org_1",
  key: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  keyLocation: null,
  enabled: true,
  webhookSecret: null,
  lastVerifiedAt: null,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  ...overrides,
});

describe("IndexNow service", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      name: "Acme",
      domain: "acme.com",
      locationCode: 2840,
      languageCode: "en",
    });
    mocks.getByProjectId.mockResolvedValue(config());
    mocks.upsertKey.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve(config(input)),
    );
    mocks.insertPending.mockImplementation((input: { urls: string[] }) =>
      Promise.resolve(
        input.urls.map((url, index) => ({ id: `event_${index}`, url })),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults the key location to the project's host", async () => {
    const state = await getState("org_1", "project_1");

    expect(state.setup?.keyLocation).toBe(
      "https://acme.com/a1b2c3d4e5f60718293a4b5c6d7e8f90.txt",
    );
  });

  // The verify button fetches this URL, so accepting an arbitrary one would
  // turn it into a server-side request forgery primitive.
  it("refuses a key location that is not HTTPS on the project's host", async () => {
    await expect(
      saveKey("org_1", {
        projectId: "project_1",
        key: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        keyLocation: "http://169.254.169.254/latest/meta-data/",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.upsertKey).not.toHaveBeenCalled();
  });

  // A stored location survives a domain change; using it would advertise a host
  // this project no longer owns.
  it("ignores a stored key location once the project's domain changes", async () => {
    mocks.getByProjectId.mockResolvedValue(
      config({ keyLocation: "https://old-domain.com/keys/key.txt" }),
    );

    const state = await getState("org_1", "project_1");

    expect(state.setup?.keyLocation).toBe(
      "https://acme.com/a1b2c3d4e5f60718293a4b5c6d7e8f90.txt",
    );
  });

  it("keeps the existing key instead of provisioning a second one", async () => {
    await expect(ensureKey("org_1", "project_1")).resolves.toMatchObject({
      key: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    });
    expect(mocks.upsertKey).not.toHaveBeenCalled();
  });

  it("submits in batches of 100 and skips cross-host URLs", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const urls = Array.from(
      { length: 150 },
      (_, index) => `https://acme.com/page-${index}`,
    );

    const result = await submitUrls("org_1", {
      projectId: "project_1",
      urls: [...urls, "https://elsewhere.com/x"],
      source: "ui",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.submitted).toBe(150);
    expect(result.skipped).toEqual(["https://elsewhere.com/x"]);
  });

  // 429 is congestion; 403 means the key file isn't published, and retrying
  // that just burns time on an answer that will not change.
  it("retries a rate limit but not a rejected key", async () => {
    const rateLimited = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", rateLimited);

    const retried = await submitUrls("org_1", {
      projectId: "project_1",
      urls: ["https://acme.com/a"],
      source: "mcp",
    });
    expect(rateLimited).toHaveBeenCalledTimes(2);
    expect(retried.ok).toBe(true);

    const forbidden = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 403 })),
    );
    vi.stubGlobal("fetch", forbidden);

    const rejected = await submitUrls("org_1", {
      projectId: "project_1",
      urls: ["https://acme.com/a"],
      source: "mcp",
    });
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(rejected).toMatchObject({ ok: false, status: 403, failed: 1 });
  });

  it("refuses to submit while IndexNow is paused", async () => {
    mocks.getByProjectId.mockResolvedValue(config({ enabled: false }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitUrls("org_1", {
        projectId: "project_1",
        urls: ["https://acme.com/a"],
        source: "ui",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a key file with the wrong contents as unverified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("some other key"))),
    );

    const result = await verifyKey("org_1", { projectId: "project_1" });

    expect(result.verified).toBe(false);
    expect(mocks.markVerified).toHaveBeenCalledWith("project_1", null);
  });
});
