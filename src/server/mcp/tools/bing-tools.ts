import { z } from "zod";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { BingService } from "@/server/features/bing/services/BingService";

// Bing's payload shapes vary by endpoint and account; they are passed through
// verbatim rather than reshaped into a schema that would silently drop fields.
const passthroughRows = z.array(z.record(z.string(), z.unknown()));

export const getBingVisibilityTool = {
  name: "get_bing_visibility",
  config: {
    title: "Get Bing visibility",
    description:
      "Return Bing Webmaster rank and traffic stats (impressions, clicks, average position) for the project's connected Bing property. Uses no DataForSEO credits. Bing's index feeds Copilot and ChatGPT search, so this is the closest read on how visible a site is in those answers. Requires Bing Webmaster to be connected in project settings.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      siteUrl: z.string(),
      visibility: z.union([passthroughRows, z.record(z.string(), z.unknown())]),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const result = await BingService.getVisibility({
      organizationId: context.auth.organizationId,
      projectId: args.projectId,
    });
    return mcpResponse({
      text: `Bing visibility for ${result.siteUrl}.`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: {
        siteUrl: result.siteUrl,
        visibility: result.visibility,
      },
    });
  }),
};

export const getBingCrawlIssuesTool = {
  name: "get_bing_crawl_issues",
  config: {
    title: "Get Bing crawl issues",
    description:
      "Return the crawl problems Bing Webmaster reports for the project's connected property — pages it could not fetch, index, or render. Uses no DataForSEO credits. Pair with submit_urls_indexnow after fixing an issue to get the page re-crawled quickly. Requires Bing Webmaster to be connected in project settings.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      siteUrl: z.string(),
      issueCount: z.number(),
      issues: passthroughRows,
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const result = await BingService.getCrawlIssues({
      organizationId: context.auth.organizationId,
      projectId: args.projectId,
    });
    return mcpResponse({
      text: `${result.issues.length} Bing crawl issue(s) for ${result.siteUrl}.`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: {
        siteUrl: result.siteUrl,
        issueCount: result.issues.length,
        issues: result.issues,
      },
    });
  }),
};
