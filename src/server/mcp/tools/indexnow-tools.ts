import { z } from "zod";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { IndexNowService } from "@/server/features/indexnow/services/IndexNowService";
import { describeIndexNowStatus } from "@/shared/indexnow";

export const getIndexNowKeyTool = {
  name: "get_indexnow_key",
  config: {
    title: "Get IndexNow key",
    description:
      "Return the project's IndexNow key and the verification file to publish. Uses no credits. The key is stored on the project and shown in its settings; the first call generates one, later calls return that same key. To activate IndexNow, host a file at the returned keyLocation whose entire contents are the key, then check it with verify_indexnow_key and submit URLs with submit_urls_indexnow. Requires the project to have a domain.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      host: z.string(),
      key: z.string(),
      keyLocation: z.string(),
      keyFileContent: z.string(),
      enabled: z.boolean(),
      lastVerifiedAt: z.string().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      // Provisions the key on first call, so not strictly read-only — but it
      // never replaces an existing one.
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const setup = await IndexNowService.ensureKey(
      context.auth.organizationId,
      args.projectId,
    );
    return mcpResponse({
      text: `IndexNow key for ${setup.host}: ${setup.key}\nPublish ${setup.keyLocation} containing exactly:\n${setup.key}\nThen call submit_urls_indexnow to notify Bing/Yandex.`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: {
        host: setup.host,
        key: setup.key,
        keyLocation: setup.keyLocation,
        keyFileContent: setup.key,
        enabled: setup.enabled,
        lastVerifiedAt: setup.lastVerifiedAt,
      },
    });
  }),
};

export const verifyIndexNowKeyTool = {
  name: "verify_indexnow_key",
  config: {
    title: "Verify the IndexNow key file",
    description:
      "Fetch the project's IndexNow verification file and check that it contains the project's key. Uses no credits. Run this after publishing the file: engines answer 403 to submissions until it is live, and this reports exactly why (missing file, wrong contents, unreachable host).",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      verified: z.boolean(),
      keyLocation: z.string(),
      status: z.number().nullable(),
      detail: z.string(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const result = await IndexNowService.verifyKey(
      context.auth.organizationId,
      { projectId: args.projectId },
    );
    return mcpResponse({
      text: `${result.verified ? "Verified" : "Not verified"}: ${result.detail} (${result.keyLocation})`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: {
        verified: result.verified,
        keyLocation: result.keyLocation,
        status: result.status,
        detail: result.detail,
      },
    });
  }),
};

export const submitUrlsIndexNowTool = {
  name: "submit_urls_indexnow",
  config: {
    title: "Submit URLs to IndexNow",
    description:
      "Notify Bing, Yandex, and other IndexNow engines that URLs are new or updated — free, no DataForSEO credits, typically indexed within seconds. Google does NOT participate in IndexNow, so this does not affect Google indexing. All URLs must be on the project's domain (cross-host URLs are skipped and reported). The project needs an IndexNow key (call get_indexnow_key), and the verification file must already be published, or engines will ignore the submission. Submissions are sent in batches of 100 and every attempt is recorded in the project's indexing history. The engine's HTTP status is returned as data (`status`, `ok`), not a tool error: 202 = accepted with key validation pending, 403 = key file not published yet.",
    inputSchema: {
      projectId: projectIdSchema,
      urls: z
        .array(z.string().url())
        .min(1)
        .max(10000)
        .describe(
          "Absolute URLs on the project's domain to (re)index (1-10000).",
        ),
    },
    outputSchema: z.looseObject({
      host: z.string(),
      submitted: z.number(),
      failed: z.number(),
      skipped: z.array(z.string()),
      status: z.number().nullable(),
      ok: z.boolean(),
      keyLocation: z.string(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; urls: string[] }, context) => {
      const result = await IndexNowService.submitUrls(
        context.auth.organizationId,
        { projectId: args.projectId, urls: args.urls, source: "mcp" },
      );
      const skippedNote =
        result.skipped.length > 0
          ? ` Skipped ${result.skipped.length} URL(s) not on ${result.host}.`
          : "";
      const failedNote =
        result.failed > 0 ? ` ${result.failed} URL(s) were rejected.` : "";
      const statusNote =
        result.status === null
          ? "no response"
          : `HTTP ${result.status} — ${describeIndexNowStatus(result.status)}`;
      return mcpResponse({
        text: `Submitted ${result.submitted} URL(s) for ${result.host} to IndexNow (${statusNote}).${failedNote}${skippedNote}`,
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: {
          host: result.host,
          submitted: result.submitted,
          failed: result.failed,
          skipped: result.skipped,
          status: result.status,
          ok: result.ok,
          keyLocation: result.keyLocation,
        },
      });
    },
  ),
};

export const getIndexingHistoryTool = {
  name: "get_indexing_history",
  config: {
    title: "Get IndexNow submission history",
    description:
      "List this project's recent IndexNow activity — URL submissions and key verifications, with the engine's status for each and whether it came from the UI, an agent, or a deploy webhook. Uses no credits. Use it to check whether a URL was already submitted before resubmitting.",
    inputSchema: {
      projectId: projectIdSchema,
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("How many events to return, newest first (default 50)."),
    },
    outputSchema: z.looseObject({
      events: z.array(
        z.looseObject({
          url: z.string(),
          eventType: z.string(),
          status: z.string(),
          source: z.string(),
          httpStatus: z.number().nullable(),
          createdAt: z.string(),
        }),
      ),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; limit?: number }, context) => {
      const events = await IndexNowService.listEvents(
        context.auth.organizationId,
        { projectId: args.projectId, limit: args.limit ?? 50 },
      );
      return mcpResponse({
        text: `${events.length} indexing event(s) for this project, newest first.`,
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: {
          events: events.map((event) => ({
            url: event.url,
            eventType: event.eventType,
            status: event.status,
            source: event.source,
            httpStatus: event.httpStatus,
            createdAt: event.createdAt,
          })),
        },
      });
    },
  ),
};
