import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/client/components/CopyButton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  generateIndexNowKey,
  getIndexNowState,
  removeIndexNowKey,
  saveIndexNowKey,
  setIndexNowEnabled,
  verifyIndexNowKey,
} from "@/serverFunctions/indexnow";
import { INDEXNOW_KEY_RULE, isValidIndexNowKey } from "@/shared/indexnow";
import type { ProjectSummary } from "./types";

export const indexNowStateKey = (projectId: string) => [
  "indexNowState",
  projectId,
];

/**
 * IndexNow key management for a project. The key is not a secret — control of
 * the host is proven by serving `<key>.txt` on it — so it is displayed in full,
 * and users can adopt a key their site already publishes instead of a
 * generated one.
 */
export function IndexNowCard({ project }: { project: ProjectSummary }) {
  const queryClient = useQueryClient();
  const [pastedKey, setPastedKey] = React.useState("");
  const [replacing, setReplacing] = React.useState(false);

  const stateQuery = useQuery({
    queryKey: indexNowStateKey(project.id),
    queryFn: () => getIndexNowState({ data: { projectId: project.id } }),
    enabled: Boolean(project.domain),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: indexNowStateKey(project.id),
    });
  };

  const settle = async (message: string) => {
    await refresh();
    setPastedKey("");
    setReplacing(false);
    toast.success(message);
  };

  const saveMutation = useMutation({
    mutationFn: (key: string) =>
      saveIndexNowKey({ data: { projectId: project.id, key } }),
    onSuccess: () => settle("IndexNow key saved"),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to save the key")),
  });

  const generateMutation = useMutation({
    mutationFn: () => generateIndexNowKey({ data: { projectId: project.id } }),
    onSuccess: () => settle("IndexNow key generated"),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to generate a key")),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeIndexNowKey({ data: { projectId: project.id } }),
    onSuccess: () => settle("IndexNow key removed"),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to remove the key")),
  });

  const enabledMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      setIndexNowEnabled({ data: { projectId: project.id, enabled } }),
    onSuccess: async (_result, enabled) => {
      await refresh();
      toast.success(enabled ? "IndexNow resumed" : "IndexNow paused");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyIndexNowKey({ data: { projectId: project.id } }),
    onSuccess: async (result) => {
      await refresh();
      if (result.verified) toast.success(result.detail);
      else toast.error(result.detail);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not check the file")),
  });

  const busy =
    saveMutation.isPending ||
    generateMutation.isPending ||
    removeMutation.isPending ||
    enabledMutation.isPending;
  const keyIsValid = isValidIndexNowKey(pastedKey.trim());
  const setup = stateQuery.data?.setup ?? null;

  if (!project.domain) {
    return (
      <p className="text-sm text-base-content/60">
        Add a domain above to set up IndexNow.
      </p>
    );
  }

  if (stateQuery.isPending) {
    return <span className="loading loading-spinner loading-sm" />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-base-content/60">
        IndexNow tells Bing, Yandex, and other participating engines that a page
        is new or updated, usually within seconds and at no cost. Google does
        not participate.
      </p>

      {setup && !replacing ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Key</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-base-300 bg-base-200 px-3 py-2 font-mono text-xs">
                {setup.key}
              </code>
              <CopyButton value={setup.key} successMessage="Key copied" />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Verification file</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-base-300 bg-base-200 px-3 py-2 font-mono text-xs">
                {setup.keyLocation}
              </code>
              <CopyButton
                value={setup.keyLocation}
                successMessage="URL copied"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {setup.lastVerifiedAt ? (
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <BadgeCheck className="size-3.5" />
                  Live as of {new Date(setup.lastVerifiedAt).toLocaleString()}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-base-content/50">
                  <ShieldAlert className="size-3.5" />
                  Not checked yet — engines reject submissions with HTTP 403
                  until this file is live.
                </span>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => verifyMutation.mutate()}
                disabled={verifyMutation.isPending || busy}
              >
                {verifyMutation.isPending ? "Checking…" : "Check now"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={setup.enabled}
                onChange={(event) =>
                  enabledMutation.mutate(event.target.checked)
                }
                disabled={busy}
              />
              <span>
                {setup.enabled
                  ? "Submissions enabled"
                  : "Paused — submissions are refused"}
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => removeMutation.mutate()}
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

          <p className="text-sm text-base-content/60">
            Submit URLs and review past submissions on the{" "}
            <Link
              to="/p/$projectId/indexing"
              params={{ projectId: project.id }}
              className="link link-hover font-medium"
            >
              Indexing page
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {setup ? (
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
              {setup ? (
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
