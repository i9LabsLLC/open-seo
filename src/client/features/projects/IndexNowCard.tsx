import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyButton } from "@/client/features/ai-mcp/SetupControls";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  generateProjectIndexNowKey,
  setProjectIndexNowKey,
} from "@/serverFunctions/projects";
import { INDEXNOW_KEY_RULE, isValidIndexNowKey } from "@/shared/indexnow";
import type { ProjectSummary } from "./types";

/**
 * IndexNow setup for a project. The key is not a secret — control of the host
 * is proven by serving `<key>.txt` at its root — so it is displayed in full,
 * and users can paste a key their site already publishes instead of adopting a
 * generated one.
 */
export function IndexNowCard({ project }: { project: ProjectSummary }) {
  const queryClient = useQueryClient();
  const [pastedKey, setPastedKey] = React.useState("");
  const [replacing, setReplacing] = React.useState(false);

  const onSettled = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    setPastedKey("");
    setReplacing(false);
    toast.success(message);
  };

  const saveMutation = useMutation({
    mutationFn: (key: string) =>
      setProjectIndexNowKey({ data: { projectId: project.id, key } }),
    onSuccess: (_result, key) =>
      onSettled(key ? "IndexNow key saved" : "IndexNow key removed"),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to save the key")),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      generateProjectIndexNowKey({ data: { projectId: project.id } }),
    onSuccess: () => onSettled("IndexNow key generated"),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to generate a key")),
  });

  const busy = saveMutation.isPending || generateMutation.isPending;
  const keyIsValid = isValidIndexNowKey(pastedKey.trim());
  const key = project.indexNowKey;
  const keyLocation = project.domain
    ? `https://${project.domain}/${key}.txt`
    : null;

  if (!project.domain) {
    return (
      <p className="text-sm text-base-content/60">
        Add a domain above to set up IndexNow.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-base-content/60">
        IndexNow tells Bing, Yandex, and other participating engines that a page
        is new or updated, usually within seconds and at no cost. Google does
        not participate.
      </p>

      {key && !replacing ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Key</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-base-300 bg-base-200 px-3 py-2 font-mono text-xs">
                {key}
              </code>
              <CopyButton value={key} successMessage="Key copied" />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Verification file</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-base-300 bg-base-200 px-3 py-2 font-mono text-xs">
                {keyLocation}
              </code>
              <CopyButton
                value={keyLocation ?? ""}
                successMessage="URL copied"
              />
            </div>
            <p className="text-xs text-base-content/50">
              Host a plain-text file at that URL whose entire contents are the
              key above. Until it resolves, engines reject submissions with HTTP
              403.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => saveMutation.mutate("")}
              disabled={busy}
            >
              Remove
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setReplacing(true)}
              disabled={busy}
            >
              Replace key
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {key ? (
            <p className="text-sm text-base-content/70">
              Replacing the key invalidates the file you already published —
              you&apos;ll need to publish the new one before submitting URLs
              again.
            </p>
          ) : null}

          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !keyIsValid) return;
              saveMutation.mutate(pastedKey.trim());
            }}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={pastedKey}
                onChange={(event) => setPastedKey(event.target.value)}
                placeholder="Paste an existing key"
                maxLength={128}
                aria-invalid={pastedKey.trim() !== "" && !keyIsValid}
                className="input input-bordered w-full font-mono text-sm sm:flex-1"
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm sm:self-center"
                disabled={busy || !keyIsValid}
              >
                Save key
              </button>
            </div>
            {pastedKey.trim() !== "" && !keyIsValid ? (
              <p className="text-xs text-error">{INDEXNOW_KEY_RULE}</p>
            ) : null}
          </form>

          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-base-content/60">
              Or let OpenSEO generate one for you.
            </p>
            <div className="flex gap-2">
              {key ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setPastedKey("");
                    setReplacing(false);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-outline btn-sm shrink-0"
                onClick={() => generateMutation.mutate()}
                disabled={busy}
              >
                Generate key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
