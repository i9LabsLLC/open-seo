import { createFileRoute } from "@tanstack/react-router";
import { handleSelfHostedBingOAuthCallbackRequest } from "@/server/features/bing/selfHostedOAuth";

export const Route = createFileRoute("/api/bing/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        handleSelfHostedBingOAuthCallbackRequest(request),
    },
  },
});
