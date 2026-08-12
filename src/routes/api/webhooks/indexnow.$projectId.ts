import { createFileRoute } from "@tanstack/react-router";
import { handleIndexNowWebhookRequest } from "@/server/features/indexnow/webhook";

// Deploy hook, authorized by the project's own webhook secret rather than a
// session — CI has no browser. See handleIndexNowWebhookRequest for why the
// secret is per project and why failures answer 404.
export const Route = createFileRoute("/api/webhooks/indexnow/$projectId")({
  server: {
    handlers: {
      POST: ({
        request,
        params,
      }: {
        request: Request;
        params: { projectId: string };
      }) => handleIndexNowWebhookRequest(request, params.projectId),
    },
  },
});
