import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CodeBlock, CopyButton } from "@/client/features/ai-mcp/SetupControls";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { indexNowStateKey } from "@/client/features/projects/IndexNowCard";
import {
  revokeIndexNowWebhookSecret,
  rotateIndexNowWebhookSecret,
} from "@/serverFunctions/indexnow";

/**
 * Deploy-hook setup. The secret is shown once, right after it is issued —
 * afterwards only its existence is known, so a lost secret is rotated rather
 * than recovered.
 */
export function IndexNowWebhookCard({
  projectId,
  hasSecret,
}: {
  projectId: string;
  hasSecret: boolean;
}) {
  const queryClient = useQueryClient();
  const [issuedSecret, setIssuedSecret] = React.useState<string | null>(null);

  const webhookUrl =
    typeof window === "undefined"
      ? `/api/webhooks/indexnow/${projectId}`
      : `${window.location.origin}/api/webhooks/indexnow/${projectId}`;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: indexNowStateKey(projectId) });

  const rotateMutation = useMutation({
    mutationFn: () => rotateIndexNowWebhookSecret({ data: { projectId } }),
    onSuccess: async (result) => {
      setIssuedSecret(result.secret);
      await refresh();
      toast.success("Webhook secret issued");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to issue a secret")),
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeIndexNowWebhookSecret({ data: { projectId } }),
    onSuccess: async () => {
      setIssuedSecret(null);
      await refresh();
      toast.success("Webhook secret revoked");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to revoke")),
  });

  const busy = rotateMutation.isPending || revokeMutation.isPending;

  return (
    <section className="card border border-base-300 bg-base-100">
      <div className="card-body gap-3">
        <div>
          <h2 className="card-title text-base">Deploy webhook</h2>
          <p className="text-sm text-base-content/60">
            Let your CI or host submit URLs automatically after a deploy. The
            secret is scoped to this project — it can never submit for another
            one.
          </p>
        </div>

        {issuedSecret ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Copy this secret now — it isn&apos;t shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-base-300 bg-base-200 px-3 py-2 font-mono text-xs">
                {issuedSecret}
              </code>
              <CopyButton value={issuedSecret} successMessage="Secret copied" />
            </div>
            <CodeBlock
              code={`curl -X POST ${webhookUrl} \\\n  -H "X-IndexNow-Webhook-Secret: ${issuedSecret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"urls":["https://example.com/changed-page"]}'`}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-base-300 bg-base-200 px-3 py-2 font-mono text-xs">
                {webhookUrl}
              </code>
              <CopyButton value={webhookUrl} successMessage="URL copied" />
            </div>
            <p className="text-xs text-base-content/50">
              {hasSecret
                ? "A secret is set. Issue a new one if it was lost — the old one stops working immediately."
                : "No secret yet. Issue one to enable the endpoint for this project."}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => rotateMutation.mutate()}
            disabled={busy}
          >
            {hasSecret ? "Issue a new secret" : "Issue a secret"}
          </button>
          {hasSecret ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => revokeMutation.mutate()}
              disabled={busy}
            >
              Revoke
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
