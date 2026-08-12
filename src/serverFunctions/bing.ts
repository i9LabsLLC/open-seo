import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { BingService } from "@/server/features/bing/services/BingService";
import { hasSelfHostedBingConfig } from "@/server/features/bing/oauth-config";
import { createSelfHostedBingAuthorizationUrl } from "@/server/features/bing/selfHostedOAuth";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const setSiteSchema = projectScopedSchema.extend({
  accountId: z.string().min(1),
  siteUrl: z.string().min(1),
});
const startLinkSchema = z.object({ callbackURL: z.string().min(1) });

export const getBingConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [status, oauthConfigured] = await Promise.all([
      BingService.getConnectionStatus({
        organizationId: context.organizationId,
        projectId: context.projectId,
        userId: context.userId,
      }),
      hasSelfHostedBingConfig(),
    ]);
    return { ...status, oauthConfigured };
  });

export const listBingSites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => BingService.listSites(context.userId));

export const setBingSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setSiteSchema)
  .handler(async ({ data, context }) =>
    BingService.setSite({
      organizationId: context.organizationId,
      projectId: context.projectId,
      siteUrl: data.siteUrl,
      accountId: data.accountId,
      userId: context.userId,
    }),
  );

export const disconnectBing = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) =>
    BingService.disconnect({
      organizationId: context.organizationId,
      projectId: context.projectId,
      userId: context.userId,
    }),
  );

export const startSelfHostedBingLink = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(startLinkSchema)
  .handler(async ({ data, context }) => {
    const url = await createSelfHostedBingAuthorizationUrl({
      user: { userId: context.userId, userEmail: context.userEmail },
      callbackURL: data.callbackURL,
      publicOrigin: getPublicOrigin(getRequest()),
    });
    return { url };
  });
