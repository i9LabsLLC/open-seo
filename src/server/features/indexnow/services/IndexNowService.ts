import {
  ensureKey,
  generateKey,
  getState,
  listEvents,
  removeKey,
  revokeWebhookSecret,
  rotateWebhookSecret,
  saveKey,
  setEnabled,
  submitUrls,
  verifyKey,
} from "@/server/features/indexnow/services/indexnow";

export const IndexNowService = {
  getState,
  saveKey,
  generateKey,
  ensureKey,
  setEnabled,
  removeKey,
  verifyKey,
  submitUrls,
  listEvents,
  rotateWebhookSecret,
  revokeWebhookSecret,
} as const;
