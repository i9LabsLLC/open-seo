import { env } from "cloudflare:workers";
import { symmetricEncrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { z } from "zod";
import { db } from "@/db";
import { account } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { getAuthMode, isHostedAuthMode } from "@/lib/auth-mode";
import { resolveCloudflareAccessContext } from "@/middleware/ensure-user/cloudflareAccess";
import { resolveLocalNoAuthContext } from "@/middleware/ensure-user/delegated";
import { AppError } from "@/server/lib/errors";
import { responseForAppError } from "@/server/lib/http-errors";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { createOAuthState, verifyOAuthState } from "@/server/lib/oauth-state";
import { BING_OAUTH_PROVIDER_ID, BING_OAUTH_SCOPES } from "@/shared/bing";
import {
  getBingOAuthClientConfig,
  hasSelfHostedBingConfig,
} from "./oauth-config";

// Bing Webmaster delegates authorization to the Microsoft identity platform.
const MICROSOFT_AUTH_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

const CALLBACK_PATH = "/api/bing/oauth/callback";
const STATE_NAMESPACE = "bing";
const DISPLAY_NAME = "Bing Webmaster";

type SelfHostedBingUser = {
  userId: string;
  userEmail: string;
};

const bingTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
  token_type: z.string().optional(),
});

type BingTokenResponse = z.infer<typeof bingTokenResponseSchema>;

function getRedirectUri(publicOrigin: string) {
  return `${publicOrigin}${CALLBACK_PATH}`;
}

function getClaimedAccountId(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const claims = decodeJwt(token);
    for (const key of ["oid", "sub", "uid"] as const) {
      const value = claims[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  } catch {
    // The access token may be opaque. The user id fallback below still gives
    // Better Auth a stable account selector for this self-hosted grant.
  }
  return null;
}

function getBingAccountId(tokens: BingTokenResponse, userId: string) {
  return (
    getClaimedAccountId(tokens.id_token) ??
    getClaimedAccountId(tokens.access_token) ??
    userId
  );
}

async function upsertGrant(input: {
  user: SelfHostedBingUser;
  tokens: BingTokenResponse;
}) {
  // Keep token encryption in lockstep with Better Auth's own OAuth write path,
  // so getAccessToken can decrypt and refresh this grant later.
  const ctx = await getAuth().$context;
  const encrypt = (value: string) =>
    ctx.options.account?.encryptOAuthTokens
      ? symmetricEncrypt({ key: ctx.secretConfig, data: value })
      : value;
  const bingAccountId = getBingAccountId(input.tokens, input.user.userId);

  const existing = await db
    .select({ id: account.id, refreshToken: account.refreshToken })
    .from(account)
    .where(
      and(
        eq(account.userId, input.user.userId),
        eq(account.providerId, BING_OAUTH_PROVIDER_ID),
        eq(account.accountId, bingAccountId),
      ),
    )
    .limit(1);

  const accountValues = {
    accountId: bingAccountId,
    providerId: BING_OAUTH_PROVIDER_ID,
    userId: input.user.userId,
    accessToken: await encrypt(input.tokens.access_token),
    // A re-authorization that returns no refresh token must not wipe the one
    // already stored, or the grant silently becomes single-use.
    refreshToken: input.tokens.refresh_token
      ? await encrypt(input.tokens.refresh_token)
      : (existing[0]?.refreshToken ?? null),
    idToken: input.tokens.id_token
      ? await encrypt(input.tokens.id_token)
      : null,
    accessTokenExpiresAt: new Date(
      Date.now() + (input.tokens.expires_in ?? 3600) * 1_000,
    ),
    refreshTokenExpiresAt: null,
    scope: input.tokens.scope
      ? input.tokens.scope.trim().split(/\s+/).join(",")
      : BING_OAUTH_SCOPES.join(","),
    password: null,
  };

  if (existing[0]) {
    await db
      .update(account)
      .set({ ...accountValues, updatedAt: new Date() })
      .where(eq(account.id, existing[0].id));
    return;
  }
  await db.insert(account).values({
    id: crypto.randomUUID(),
    ...accountValues,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function exchangeCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${DISPLAY_NAME} rejected the authorization code.`,
    );
  }
  return bingTokenResponseSchema.parse(await response.json());
}

export async function createSelfHostedBingAuthorizationUrl(input: {
  user: SelfHostedBingUser;
  callbackURL: string;
  publicOrigin: string;
}) {
  const config = await getBingOAuthClientConfig();
  if (!config || !(await hasSelfHostedBingConfig())) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Bing Webmaster OAuth is not configured. Set BING_CLIENT_ID, BING_CLIENT_SECRET, and BETTER_AUTH_SECRET, or use BING_WEBMASTER_API_KEY instead.",
    );
  }

  const state = await createOAuthState({
    stateNamespace: STATE_NAMESPACE,
    clientSecret: config.clientSecret,
    userId: input.user.userId,
    callbackURL: input.callbackURL,
    publicOrigin: input.publicOrigin,
  });
  const url = new URL(MICROSOFT_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", getRedirectUri(input.publicOrigin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", BING_OAUTH_SCOPES.join(" "));
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("state", state);
  return url.toString();
}

async function handleSelfHostedBingOAuthCallback(input: {
  request: Request;
  user: SelfHostedBingUser;
  publicOrigin: string;
}) {
  const config = await getBingOAuthClientConfig();
  if (!config) {
    return new Response(`Missing ${DISPLAY_NAME} OAuth configuration`, {
      status: 500,
    });
  }

  const url = new URL(input.request.url);
  const stateParam = url.searchParams.get("state");
  if (!stateParam) {
    return new Response(`Missing ${DISPLAY_NAME} OAuth state`, { status: 400 });
  }

  const state = await verifyOAuthState({
    state: stateParam,
    clientSecret: config.clientSecret,
    stateNamespace: STATE_NAMESPACE,
    displayName: DISPLAY_NAME,
  });
  if (state.userId !== input.user.userId) {
    return new Response(`${DISPLAY_NAME} OAuth user mismatch`, { status: 403 });
  }

  // state.callbackPath is a validated same-origin relative path. A relative
  // Location avoids trusting x-forwarded-host for the final redirect.
  const redirectToCallback = () =>
    new Response(null, {
      status: 303,
      headers: { Location: state.callbackPath },
    });

  if (url.searchParams.get("error")) return redirectToCallback();

  const code = url.searchParams.get("code");
  if (!code) {
    return new Response(`Missing ${DISPLAY_NAME} OAuth code`, { status: 400 });
  }

  const tokens = await exchangeCode({
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: getRedirectUri(input.publicOrigin),
  });
  await upsertGrant({ user: input.user, tokens });

  return redirectToCallback();
}

/**
 * Route entry point: resolves the self-hosted user from the deployment's auth
 * mode, then runs the callback. Hosted mode has no self-hosted flow, so it 404s
 * rather than exposing the endpoint. Mirrors the Google integrations' wrapper.
 */
export async function handleSelfHostedBingOAuthCallbackRequest(
  request: Request,
) {
  try {
    const authMode = getAuthMode(env.AUTH_MODE);
    if (isHostedAuthMode(authMode)) {
      return new Response("Not found", { status: 404 });
    }
    const context =
      authMode === "local_noauth"
        ? await resolveLocalNoAuthContext()
        : await resolveCloudflareAccessContext(request.headers);
    return await handleSelfHostedBingOAuthCallback({
      request,
      user: { userId: context.userId, userEmail: context.userEmail },
      publicOrigin: getPublicOrigin(request),
    });
  } catch (error) {
    return responseForAppError(error, `${DISPLAY_NAME} OAuth failed`);
  }
}
