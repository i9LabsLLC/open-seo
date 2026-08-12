import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { MIN_BETTER_AUTH_SECRET_LENGTH } from "@/shared/selfhost-checks";

type BingOAuthClientConfig = {
  clientId: string;
  clientSecret: string;
};

export async function getBingOAuthClientConfig(): Promise<BingOAuthClientConfig | null> {
  const clientId = (await getOptionalEnvValue("BING_CLIENT_ID"))?.trim();
  const clientSecret = (
    await getOptionalEnvValue("BING_CLIENT_SECRET")
  )?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// Self-hosted Bing OAuth needs both the Microsoft OAuth client and
// BETTER_AUTH_SECRET (the latter encrypts the stored tokens).
export async function hasSelfHostedBingConfig(): Promise<boolean> {
  if (!(await getBingOAuthClientConfig())) return false;
  const secret = (await getOptionalEnvValue("BETTER_AUTH_SECRET"))?.trim();
  return Boolean(secret && secret.length >= MIN_BETTER_AUTH_SECRET_LENGTH);
}

// The simpler alternative to OAuth: the key from Bing Webmaster Tools →
// Settings → API Access. Read at request time and never stored in our tables.
export async function getBingWebmasterApiKey(): Promise<string | null> {
  return (await getOptionalEnvValue("BING_WEBMASTER_API_KEY"))?.trim() ?? null;
}
