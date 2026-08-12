// IndexNow protocol constants and key rules, shared so the client and the
// settings card apply exactly the rule the server enforces.

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

// The protocol accepts up to 10,000 URLs per request. Submissions are cut into
// smaller batches so one rejected batch does not fail the whole run and so the
// ledger records progress as it goes.
export const INDEXNOW_MAX_URLS_PER_SUBMISSION = 10_000;
export const INDEXNOW_BATCH_SIZE = 100;

// Retries cover 429s, 5xx, and network failures. Two short backoffs is enough
// for a transient blip without holding a request open.
export const INDEXNOW_MAX_ATTEMPTS = 3;
export const INDEXNOW_RETRY_DELAYS_MS = [250, 1_000] as const;

// The protocol accepts 8-128 chars of [a-zA-Z0-9-]. Generated keys are 32 hex
// chars, but a pasted one only has to satisfy the protocol.
const INDEXNOW_KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export const INDEXNOW_KEY_RULE =
  "An IndexNow key is 8-128 characters, using letters, numbers, and dashes only.";

export function isValidIndexNowKey(key: string): boolean {
  return INDEXNOW_KEY_PATTERN.test(key);
}

// Where a submission came from. The event types and statuses live on the table
// definition, which is their only consumer.
const INDEXING_EVENT_SOURCES = ["ui", "mcp", "webhook"] as const;
export type IndexingEventSource = (typeof INDEXING_EVENT_SOURCES)[number];

/** What the engine's status code means, for the UI and tool descriptions. */
export function describeIndexNowStatus(status: number): string {
  if (status === 200) return "Accepted";
  if (status === 202) return "Accepted, key validation pending";
  if (status === 400) return "Invalid request";
  if (status === 403) return "Key file not found or does not match";
  if (status === 422) return "URLs do not belong to the host";
  if (status === 429) return "Rate limited";
  return `HTTP ${status}`;
}
