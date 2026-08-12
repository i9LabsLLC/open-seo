import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { indexingEvents } from "@/db/schema";

export type IndexingEventRecord = typeof indexingEvents.$inferSelect;

// Timestamps are written as ISO-8601 rather than left to the column default:
// SQLite's `current_timestamp` and Postgres' `isoNow` produce different text,
// and the dedupe window and history both compare these values lexicographically.
const nowIso = () => new Date().toISOString();

/** Records one pending row per URL and returns them in the order given. */
async function insertPending(input: {
  projectId: string;
  organizationId: string;
  urls: string[];
  eventType: IndexingEventRecord["eventType"];
  source: IndexingEventRecord["source"];
}): Promise<IndexingEventRecord[]> {
  const createdAt = nowIso();
  const rows: IndexingEventRecord[] = input.urls.map((url) => ({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    organizationId: input.organizationId,
    url,
    eventType: input.eventType,
    status: "pending",
    source: input.source,
    httpStatus: null,
    responseBody: null,
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
  }));

  await runBatch((tx) =>
    rows.map((row) => tx.insert(indexingEvents).values(row)),
  );
  return rows;
}

/** Resolves a batch of pending rows with the engine's answer. */
async function markResult(
  ids: string[],
  result: {
    eventType: IndexingEventRecord["eventType"];
    status: IndexingEventRecord["status"];
    httpStatus?: number | null;
    responseBody?: string | null;
    attempts: number;
  },
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(indexingEvents)
    .set({
      eventType: result.eventType,
      status: result.status,
      httpStatus: result.httpStatus ?? null,
      responseBody: result.responseBody ?? null,
      attempts: result.attempts,
      updatedAt: nowIso(),
    })
    .where(inArray(indexingEvents.id, ids));
}

async function listByProjectId(
  projectId: string,
  options: { limit: number; offset?: number },
): Promise<IndexingEventRecord[]> {
  return db
    .select()
    .from(indexingEvents)
    .where(eq(indexingEvents.projectId, projectId))
    .orderBy(desc(indexingEvents.createdAt), desc(indexingEvents.id))
    .limit(options.limit)
    .offset(options.offset ?? 0);
}

/**
 * URLs this project submitted successfully since `sinceIso`, for the webhook's
 * dedupe window. Compared as text, which is why writes use ISO-8601.
 */
async function listSucceededSince(
  projectId: string,
  sinceIso: string,
): Promise<string[]> {
  const rows = await db
    .select({ url: indexingEvents.url })
    .from(indexingEvents)
    .where(
      and(
        eq(indexingEvents.projectId, projectId),
        eq(indexingEvents.eventType, "submitted"),
        eq(indexingEvents.status, "success"),
        gte(indexingEvents.createdAt, sinceIso),
      ),
    );
  return rows.map((row) => row.url);
}

export const IndexingEventRepository = {
  insertPending,
  markResult,
  listByProjectId,
  listSucceededSince,
} as const;
