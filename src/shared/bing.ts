/** Better Auth providerId for the incremental Bing Webmaster connection. */
export const BING_OAUTH_PROVIDER_ID = "bing-webmaster";

export const BING_OAUTH_SCOPES = [
  "webmaster.read",
  "webmaster.manage",
] as const;

/**
 * Sentinel `connectedByUserId`/account id for deployments that authenticate
 * with an operator-managed Webmaster API key instead of a per-user OAuth grant.
 * One key serves the whole instance, so there is no user to attribute it to.
 */
export const BING_API_KEY_ACCOUNT_ID = "api-key";
