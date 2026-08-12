import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  bingConnections,
  indexnowConfigs,
  indexingEvents,
  projects,
} from "@/db/schema";
import { BingService } from "@/server/features/bing/services/BingService";
import { BingApiError, BingTokenError } from "@/server/lib/bingErrors";
import { indexNowHostFromDomain } from "@/server/lib/indexnow";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

const RECENT_EVENT_LIMIT = 50;
// Bing is queried live, one round trip per connected project. Capping keeps a
// workspace with many projects from turning this page into a fan-out of
// third-party calls; the UI says when projects were left out.
const BING_PROJECT_LIMIT = 10;
const BING_ISSUE_SAMPLE = 5;

type WarRoomIndexingProject = {
  projectId: string;
  projectName: string;
  host: string | null;
  enabled: boolean;
  verified: boolean;
  counts: { pending: number; success: number; error: number; total: number };
};

/**
 * Org-wide IndexNow status: which projects are set up, whether their key file
 * is verified, and how their submissions have landed. Keys and engine response
 * bodies stay server-side — this is operational status only.
 */
export const getWarRoomIndexingTelemetry = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const organizationId = context.organizationId;
    const activeProjects = and(
      eq(projects.organizationId, organizationId),
      isNull(projects.archivedAt),
    );

    const [configRows, countRows, recentRows] = await Promise.all([
      db
        .select({
          projectId: indexnowConfigs.projectId,
          projectName: projects.name,
          domain: projects.domain,
          enabled: indexnowConfigs.enabled,
          lastVerifiedAt: indexnowConfigs.lastVerifiedAt,
        })
        .from(indexnowConfigs)
        .innerJoin(projects, eq(indexnowConfigs.projectId, projects.id))
        .where(activeProjects),
      db
        .select({
          projectId: indexingEvents.projectId,
          status: indexingEvents.status,
          total: count(),
        })
        .from(indexingEvents)
        .innerJoin(projects, eq(indexingEvents.projectId, projects.id))
        .where(activeProjects)
        .groupBy(indexingEvents.projectId, indexingEvents.status),
      db
        .select({
          id: indexingEvents.id,
          projectName: projects.name,
          url: indexingEvents.url,
          eventType: indexingEvents.eventType,
          status: indexingEvents.status,
          source: indexingEvents.source,
          httpStatus: indexingEvents.httpStatus,
          createdAt: indexingEvents.createdAt,
        })
        .from(indexingEvents)
        .innerJoin(projects, eq(indexingEvents.projectId, projects.id))
        .where(activeProjects)
        .orderBy(desc(indexingEvents.createdAt), desc(indexingEvents.id))
        .limit(RECENT_EVENT_LIMIT),
    ]);

    const countsByProject = new Map<string, WarRoomIndexingProject["counts"]>();
    for (const row of countRows) {
      const counts = countsByProject.get(row.projectId) ?? {
        pending: 0,
        success: 0,
        error: 0,
        total: 0,
      };
      counts[row.status] += row.total;
      counts.total += row.total;
      countsByProject.set(row.projectId, counts);
    }

    const configured: WarRoomIndexingProject[] = configRows.map((row) => ({
      projectId: row.projectId,
      projectName: row.projectName,
      host: indexNowHostFromDomain(row.domain),
      enabled: row.enabled,
      verified: Boolean(row.lastVerifiedAt),
      counts: countsByProject.get(row.projectId) ?? {
        pending: 0,
        success: 0,
        error: 0,
        total: 0,
      },
    }));

    return { projects: configured, recentEvents: recentRows };
  });

type WarRoomBingProject = {
  projectId: string;
  projectName: string;
  siteUrl: string;
  issueCount: number | null;
  issueSample: string[];
  error: string | null;
};

function describeBingError(error: unknown): string {
  if (error instanceof BingTokenError) {
    return "The Bing connection needs to be re-authorized.";
  }
  if (error instanceof BingApiError) return error.message;
  return "Bing Webmaster could not be reached.";
}

/** A crawl issue's most identifying field, whatever Bing called it. */
function describeIssue(issue: Record<string, unknown>): string {
  for (const key of ["Url", "url", "IssueType", "issueType"]) {
    const value = issue[key];
    if (typeof value === "string" && value) return value;
  }
  return "Unlabelled issue";
}

/** Live Bing crawl-issue counts for every connected project in the org. */
export const getWarRoomBingTelemetry = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const connections = await db
      .select({
        projectId: bingConnections.projectId,
        projectName: projects.name,
        siteUrl: bingConnections.siteUrl,
      })
      .from(bingConnections)
      .innerJoin(projects, eq(bingConnections.projectId, projects.id))
      .where(
        and(
          eq(bingConnections.organizationId, context.organizationId),
          isNull(projects.archivedAt),
        ),
      );

    const queried = connections.slice(0, BING_PROJECT_LIMIT);
    const results: WarRoomBingProject[] = await Promise.all(
      queried.map(async (connection) => {
        try {
          const { issues } = await BingService.getCrawlIssues({
            organizationId: context.organizationId,
            projectId: connection.projectId,
          });
          return {
            ...connection,
            issueCount: issues.length,
            issueSample: issues.slice(0, BING_ISSUE_SAMPLE).map(describeIssue),
            error: null,
          };
        } catch (error) {
          return {
            ...connection,
            issueCount: null,
            issueSample: [],
            error: describeBingError(error),
          };
        }
      }),
    );

    return {
      projects: results,
      notQueried: Math.max(connections.length - queried.length, 0),
    };
  });
