import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeToolContext } from "./tool-test-support";

const STORED_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  ensureKey: vi.fn(),
  submitUrls: vi.fn(),
  verifyKey: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

vi.mock("@/server/features/indexnow/services/IndexNowService", () => ({
  IndexNowService: {
    ensureKey: mocks.ensureKey,
    submitUrls: mocks.submitUrls,
    verifyKey: mocks.verifyKey,
    listEvents: mocks.listEvents,
  },
}));

import {
  getIndexNowKeyTool,
  getIndexingHistoryTool,
  submitUrlsIndexNowTool,
  verifyIndexNowKeyTool,
} from "./indexnow-tools";

const toolContext = makeToolContext();

describe("IndexNow MCP tools", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      name: "Acme",
      domain: "acme.com",
      locationCode: 2840,
      languageCode: "en",
    });
    mocks.ensureKey.mockResolvedValue({
      projectId: "project_1",
      organizationId: "org_1",
      host: "acme.com",
      key: STORED_KEY,
      keyLocation: `https://acme.com/${STORED_KEY}.txt`,
      enabled: true,
      lastVerifiedAt: null,
      hasWebhookSecret: false,
    });
  });

  it("returns the key and the file to publish", async () => {
    const result = await getIndexNowKeyTool.handler(
      { projectId: "project_1" },
      toolContext,
    );

    expect(mocks.ensureKey).toHaveBeenCalledWith(
      toolContext.auth.organizationId,
      "project_1",
    );
    expect(result.structuredContent).toMatchObject({
      host: "acme.com",
      key: STORED_KEY,
      keyFileContent: STORED_KEY,
      keyLocation: `https://acme.com/${STORED_KEY}.txt`,
    });
  });

  // Contract: the engine's status is DATA, not a tool error. A 403 (key file
  // not published yet) is something an agent can read and act on; raising it
  // would hide the reason behind a generic failure.
  it.each([
    { status: 202, ok: true, label: "202 accepted / validation pending" },
    { status: 403, ok: false, label: "403 key not published" },
    { status: 429, ok: false, label: "429 rate limited" },
  ])("reports HTTP $label as data", async (scenario) => {
    mocks.submitUrls.mockResolvedValue({
      host: "acme.com",
      submitted: scenario.ok ? 1 : 0,
      failed: scenario.ok ? 0 : 1,
      skipped: [],
      keyLocation: `https://acme.com/${STORED_KEY}.txt`,
      status: scenario.status,
      ok: scenario.ok,
    });

    const result = await submitUrlsIndexNowTool.handler(
      { projectId: "project_1", urls: ["https://acme.com/a"] },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      status: scenario.status,
      ok: scenario.ok,
    });
    expect(result.isError).toBeFalsy();
  });

  it("passes the submission through as an mcp-sourced one", async () => {
    mocks.submitUrls.mockResolvedValue({
      host: "acme.com",
      submitted: 2,
      failed: 0,
      skipped: ["https://other.com/c"],
      keyLocation: `https://acme.com/${STORED_KEY}.txt`,
      status: 200,
      ok: true,
    });

    const result = await submitUrlsIndexNowTool.handler(
      {
        projectId: "project_1",
        urls: [
          "https://acme.com/a",
          "https://acme.com/b",
          "https://other.com/c",
        ],
      },
      toolContext,
    );

    expect(mocks.submitUrls).toHaveBeenCalledWith(
      toolContext.auth.organizationId,
      {
        projectId: "project_1",
        urls: [
          "https://acme.com/a",
          "https://acme.com/b",
          "https://other.com/c",
        ],
        source: "mcp",
      },
    );
    expect(result.structuredContent).toMatchObject({
      submitted: 2,
      skipped: ["https://other.com/c"],
    });
  });

  it("surfaces why a key file failed verification", async () => {
    mocks.verifyKey.mockResolvedValue({
      verified: false,
      keyLocation: `https://acme.com/${STORED_KEY}.txt`,
      status: 404,
      detail: "The key file returned HTTP 404.",
    });

    const result = await verifyIndexNowKeyTool.handler(
      { projectId: "project_1" },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      verified: false,
      status: 404,
    });
  });

  it("lists recent indexing events", async () => {
    mocks.listEvents.mockResolvedValue([
      {
        id: "event_1",
        url: "https://acme.com/a",
        eventType: "submitted",
        status: "success",
        source: "webhook",
        httpStatus: 200,
        attempts: 1,
        createdAt: "2026-08-12T10:00:00.000Z",
      },
    ]);

    const result = await getIndexingHistoryTool.handler(
      { projectId: "project_1" },
      toolContext,
    );

    expect(result.structuredContent).toMatchObject({
      events: [{ url: "https://acme.com/a", source: "webhook" }],
    });
  });
});
