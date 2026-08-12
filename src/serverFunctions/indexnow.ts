import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { IndexNowService } from "@/server/features/indexnow/services/IndexNowService";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

// The key's own format is validated in the service (the protocol's rule), the
// same way project domains are. Empty strings are rejected here so a blank
// submit never reaches it.
const saveKeySchema = projectScopedSchema.extend({
  key: z.string().trim().min(1).max(128),
  // Null (or omitted) means the default `https://<domain>/<key>.txt`.
  keyLocation: z.string().trim().max(2048).nullish(),
});

const setEnabledSchema = projectScopedSchema.extend({ enabled: z.boolean() });

const submitUrlsSchema = projectScopedSchema.extend({
  urls: z.array(z.string().url()).min(1).max(10_000),
});

const listEventsSchema = projectScopedSchema.extend({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export const getIndexNowState = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.getState(context.organizationId, data.projectId),
  );

export const saveIndexNowKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveKeySchema)
  .handler(async ({ data, context }) =>
    IndexNowService.saveKey(context.organizationId, {
      projectId: data.projectId,
      key: data.key,
      keyLocation: data.keyLocation ?? null,
    }),
  );

export const generateIndexNowKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.generateKey(context.organizationId, {
      projectId: data.projectId,
    }),
  );

export const setIndexNowEnabled = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setEnabledSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.setEnabled(context.organizationId, {
      projectId: data.projectId,
      enabled: data.enabled,
    }),
  );

export const removeIndexNowKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.removeKey(context.organizationId, {
      projectId: data.projectId,
    }),
  );

export const verifyIndexNowKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.verifyKey(context.organizationId, {
      projectId: data.projectId,
    }),
  );

export const submitIndexNowUrls = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(submitUrlsSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.submitUrls(context.organizationId, {
      projectId: data.projectId,
      urls: data.urls,
      source: "ui",
    }),
  );

export const listIndexingEvents = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listEventsSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.listEvents(context.organizationId, {
      projectId: data.projectId,
      limit: data.limit,
      offset: data.offset,
    }),
  );

// Returns the new secret in the response body — the only time it is readable.
export const rotateIndexNowWebhookSecret = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.rotateWebhookSecret(context.organizationId, {
      projectId: data.projectId,
    }),
  );

export const revokeIndexNowWebhookSecret = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ data, context }) =>
    IndexNowService.revokeWebhookSecret(context.organizationId, {
      projectId: data.projectId,
    }),
  );
