import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { indexnowConfigs } from "@/db/schema";

export type IndexNowConfigRecord = typeof indexnowConfigs.$inferSelect;

async function getByProjectId(projectId: string) {
  const [config] = await db
    .select()
    .from(indexnowConfigs)
    .where(eq(indexnowConfigs.projectId, projectId))
    .limit(1);
  return config ?? null;
}

/**
 * Writes the project's key. `keyLocation` null restores the default location,
 * and `lastVerifiedAt` is always cleared: the file that was verified belongs to
 * the previous key.
 */
async function upsertKey(input: {
  projectId: string;
  organizationId: string;
  key: string;
  keyLocation: string | null;
}) {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(indexnowConfigs)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      organizationId: input.organizationId,
      key: input.key,
      keyLocation: input.keyLocation,
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: indexnowConfigs.projectId,
      set: {
        key: input.key,
        keyLocation: input.keyLocation,
        lastVerifiedAt: null,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

async function setEnabled(projectId: string, enabled: boolean) {
  const [row] = await db
    .update(indexnowConfigs)
    .set({ enabled, updatedAt: new Date().toISOString() })
    .where(eq(indexnowConfigs.projectId, projectId))
    .returning();
  return row ?? null;
}

async function setWebhookSecret(projectId: string, secret: string | null) {
  const [row] = await db
    .update(indexnowConfigs)
    .set({ webhookSecret: secret, updatedAt: new Date().toISOString() })
    .where(eq(indexnowConfigs.projectId, projectId))
    .returning();
  return row ?? null;
}

async function markVerified(projectId: string, verifiedAt: string | null) {
  const [row] = await db
    .update(indexnowConfigs)
    .set({ lastVerifiedAt: verifiedAt, updatedAt: new Date().toISOString() })
    .where(eq(indexnowConfigs.projectId, projectId))
    .returning();
  return row ?? null;
}

// Removing the config is how the settings card's "Remove" clears IndexNow; the
// ledger is deliberately left intact as history.
async function deleteByProjectId(projectId: string, organizationId: string) {
  await db
    .delete(indexnowConfigs)
    .where(
      and(
        eq(indexnowConfigs.projectId, projectId),
        eq(indexnowConfigs.organizationId, organizationId),
      ),
    );
}

export const IndexNowConfigRepository = {
  getByProjectId,
  upsertKey,
  setEnabled,
  setWebhookSecret,
  markVerified,
  deleteByProjectId,
} as const;
