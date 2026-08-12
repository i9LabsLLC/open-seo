// Leaf module: the Bing error types live apart from bingClient so tests (and
// callers that only need to classify a failure) can import them without pulling
// in `@/lib/auth` and its `cloudflare:workers` dependency. Mirrors gscErrors.ts.

/** A Bing Webmaster REST call returned a non-2xx status. */
export class BingApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "BingApiError";
  }
}

/** No fresh access token could be minted for an OAuth-backed connection. */
export class BingTokenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BingTokenError";
  }
}

/** A project has no connected Bing Webmaster property. */
export class BingNotConnectedError extends Error {
  constructor(public readonly projectId: string) {
    super("Bing Webmaster is not connected for this project");
    this.name = "BingNotConnectedError";
  }
}
