import { z } from "zod";
import { AppError } from "@/server/lib/errors";

// Signed, self-contained OAuth `state` for the self-hosted authorization flows
// (Search Console, Analytics, Bing Webmaster). There is no server-side state
// store: the payload carries the user and the page to return to, and an HMAC
// keyed on the provider's client secret makes it unforgeable. Namespacing the
// key per integration keeps a state minted for one provider from validating
// against another.

const STATE_TTL_MS = 10 * 60 * 1_000;

const oauthStateSchema = z.object({
  userId: z.string().min(1),
  callbackPath: z.string().min(1),
  exp: z.number().int(),
});

type OAuthState = z.infer<typeof oauthStateSchema>;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlToBytes(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getStateKey(clientSecret: string, stateNamespace: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`openseo:${stateNamespace}:${clientSecret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Where to send the user after the callback. Anything pointing off this origin
 * collapses to "/", so a crafted authorization link cannot turn the callback
 * into an open redirect.
 */
function getSafeCallbackPath(callbackURL: string, publicOrigin: string) {
  try {
    const url = new URL(callbackURL, publicOrigin);
    if (url.origin !== publicOrigin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export async function createOAuthState(input: {
  stateNamespace: string;
  clientSecret: string;
  userId: string;
  callbackURL: string;
  publicOrigin: string;
}) {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        userId: input.userId,
        callbackPath: getSafeCallbackPath(
          input.callbackURL,
          input.publicOrigin,
        ),
        exp: Date.now() + STATE_TTL_MS,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getStateKey(input.clientSecret, input.stateNamespace),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyOAuthState(input: {
  state: string;
  clientSecret: string;
  stateNamespace: string;
  displayName: string;
}): Promise<OAuthState> {
  const [payload, signature] = input.state.split(".");
  if (!payload || !signature) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Invalid ${input.displayName} state`,
    );
  }
  const ok = await crypto.subtle.verify(
    "HMAC",
    await getStateKey(input.clientSecret, input.stateNamespace),
    base64UrlToBytes(signature),
    new TextEncoder().encode(payload),
  );
  if (!ok) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Invalid ${input.displayName} state`,
    );
  }
  const parsed = oauthStateSchema.parse(
    JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))),
  );
  if (parsed.exp < Date.now()) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Expired ${input.displayName} state`,
    );
  }
  return parsed;
}
