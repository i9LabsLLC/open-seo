// IndexNow key rules, shared so the settings card can reject a pasted key
// inline with the same rule the server enforces on save.

// The protocol accepts 8-128 chars of [a-zA-Z0-9-]. Generated keys are 32 hex
// chars, but a pasted one only has to satisfy the protocol.
const INDEXNOW_KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export const INDEXNOW_KEY_RULE =
  "An IndexNow key is 8-128 characters, using letters, numbers, and dashes only.";

export function isValidIndexNowKey(key: string): boolean {
  return INDEXNOW_KEY_PATTERN.test(key);
}
