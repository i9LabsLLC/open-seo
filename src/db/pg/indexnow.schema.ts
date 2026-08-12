import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// See src/db/pg/app.schema.ts for why timestamps are ISO-8601 UTC text.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestampColumn = (name: string) => text(name);

// IndexNow setup per project. The key is NOT a secret — host control is proven
// by serving `<key>.txt` on the project's own domain — so it is stored in the
// clear and shown in project settings.
//
// The host is deliberately NOT stored: it is always the project's domain. A
// separate host column can drift from `projects.domain` after a rename, and
// submitting for a host the project no longer tracks is never what the user
// meant.
export const indexnowConfigs = pgTable(
  "indexnow_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    // Null means the default location, `https://<domain>/<key>.txt`. Set only
    // when the site serves the file somewhere else on the same host, which the
    // protocol allows.
    keyLocation: text("key_location"),
    // Pauses submissions without discarding the key.
    enabled: boolean("enabled").notNull().default(true),
    // Per-project deploy-webhook credential. Null until the user generates one;
    // a global secret would let one leaked CI token submit for every project on
    // the instance.
    webhookSecret: text("webhook_secret"),
    // Last time the key file was fetched and matched. Cleared whenever the key
    // or its location changes, so the UI never shows a stale green check.
    lastVerifiedAt: timestampColumn("last_verified_at"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    // One config per project; saving a key replaces the row.
    uniqueIndex("indexnow_configs_project_idx").on(table.projectId),
    index("indexnow_configs_organization_idx").on(table.organizationId),
  ],
);

// Append-only ledger of every IndexNow interaction: URL submissions and key
// verifications. This is the history the Indexing page shows and the webhook
// dedupes against, so it records attempts that failed as well as those that
// succeeded.
export const indexingEvents = pgTable(
  "indexing_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The submitted URL, or the key-file location for a verification.
    url: text("url").notNull(),
    eventType: text("event_type", {
      enum: ["submitted", "verified", "failed"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "success", "error"],
    }).notNull(),
    // How the submission was triggered, so the history can tell an agent's
    // call apart from a deploy hook.
    source: text("source", {
      enum: ["ui", "mcp", "webhook"],
    }).notNull(),
    httpStatus: integer("http_status"),
    // Truncated engine response, for diagnosing a rejection.
    responseBody: text("response_body"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    // The history view and the webhook's dedupe window both read newest-first
    // within a project.
    index("indexing_events_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("indexing_events_organization_idx").on(table.organizationId),
  ],
);
