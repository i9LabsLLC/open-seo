import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { indexNowStateKey } from "@/client/features/projects/IndexNowCard";
import {
  getIndexNowState,
  listIndexingEvents,
  submitIndexNowUrls,
} from "@/serverFunctions/indexnow";
import { describeIndexNowStatus } from "@/shared/indexnow";
import { IndexNowWebhookCard } from "./IndexNowWebhookCard";

const eventsKey = (projectId: string) => ["indexingEvents", projectId];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function IndexingPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [urls, setUrls] = React.useState("");

  const stateQuery = useQuery({
    queryKey: indexNowStateKey(projectId),
    queryFn: () => getIndexNowState({ data: { projectId } }),
  });
  const eventsQuery = useQuery({
    queryKey: eventsKey(projectId),
    queryFn: () => listIndexingEvents({ data: { projectId, limit: 100 } }),
  });

  const submitMutation = useMutation({
    mutationFn: (list: string[]) =>
      submitIndexNowUrls({ data: { projectId, urls: list } }),
    onSuccess: async (result) => {
      setUrls("");
      await queryClient.invalidateQueries({ queryKey: eventsKey(projectId) });
      const skipped =
        result.skipped.length > 0
          ? ` ${result.skipped.length} not on ${result.host} were skipped.`
          : "";
      if (result.failed > 0) {
        toast.error(
          `${result.failed} URL(s) rejected${
            result.status === null
              ? ""
              : ` — ${describeIndexNowStatus(result.status)}`
          }.${skipped}`,
        );
        return;
      }
      toast.success(`Submitted ${result.submitted} URL(s).${skipped}`);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to submit")),
  });

  const setup = stateQuery.data?.setup ?? null;
  const parsedUrls = urls
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);
  const canSubmit =
    Boolean(setup?.enabled) &&
    parsedUrls.length > 0 &&
    !submitMutation.isPending;

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Indexing</h1>
          <p className="text-sm text-base-content/70">
            Push new and updated URLs to Bing, Yandex, and other IndexNow
            engines, and see how each submission was answered.
          </p>
        </div>

        {stateQuery.isPending ? (
          <span className="loading loading-spinner loading-md" />
        ) : !setup ? (
          <SetupNeeded
            projectId={projectId}
            hasDomain={Boolean(stateQuery.data?.host)}
          />
        ) : (
          <>
            {!setup.enabled ? (
              <div className="alert alert-warning">
                <span>
                  IndexNow is paused for this project. Re-enable it in project
                  settings to submit URLs.
                </span>
              </div>
            ) : null}
            {!setup.lastVerifiedAt ? (
              <div className="alert">
                <span>
                  The verification file at{" "}
                  <code className="font-mono text-xs">{setup.keyLocation}</code>{" "}
                  hasn&apos;t been confirmed live yet. Engines answer 403 until
                  it is — check it in{" "}
                  <Link
                    to="/p/$projectId/settings"
                    params={{ projectId }}
                    hash="indexnow"
                    className="link"
                  >
                    project settings
                  </Link>
                  .
                </span>
              </div>
            ) : null}

            <section className="card border border-base-300 bg-base-100">
              <div className="card-body gap-3">
                <div>
                  <h2 className="card-title text-base">Submit URLs</h2>
                  <p className="text-sm text-base-content/60">
                    One absolute URL per line, all on {setup.host}. Submissions
                    are sent in batches of 100 and retried on rate limits.
                  </p>
                </div>
                <textarea
                  className="textarea textarea-bordered min-h-32 w-full font-mono text-sm"
                  value={urls}
                  onChange={(event) => setUrls(event.target.value)}
                  placeholder={`https://${setup.host}/page-one\nhttps://${setup.host}/page-two`}
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm gap-1"
                    onClick={() => submitMutation.mutate(parsedUrls)}
                    disabled={!canSubmit}
                  >
                    <Send className="size-4" />
                    {submitMutation.isPending
                      ? "Submitting…"
                      : "Submit to IndexNow"}
                  </button>
                  {parsedUrls.length > 0 ? (
                    <span className="text-xs text-base-content/50">
                      {parsedUrls.length} URL(s) ready
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            <IndexNowWebhookCard
              projectId={projectId}
              hasSecret={setup.hasWebhookSecret}
            />
          </>
        )}

        <section className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
          <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
            <div>
              <h2 className="font-semibold">History</h2>
              <p className="text-xs text-base-content/60">
                Every submission and key check, newest first
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: eventsKey(projectId),
                })
              }
            >
              Refresh
            </button>
          </div>
          {eventsQuery.isPending ? (
            <div className="p-8 text-center">
              <span className="loading loading-spinner loading-sm" />
            </div>
          ) : (eventsQuery.data ?? []).length === 0 ? (
            <div className="p-8 text-center text-sm text-base-content/60">
              Nothing submitted yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Event</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Attempts</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {(eventsQuery.data ?? []).map((event) => (
                    <tr key={event.id}>
                      <td className="max-w-sm truncate font-mono text-xs">
                        {event.url}
                      </td>
                      <td className="text-xs">{event.eventType}</td>
                      <td>
                        <span
                          className={`badge badge-sm ${
                            event.status === "success"
                              ? "badge-success"
                              : event.status === "error"
                                ? "badge-error"
                                : "badge-warning"
                          }`}
                          title={
                            event.httpStatus === null
                              ? undefined
                              : describeIndexNowStatus(event.httpStatus)
                          }
                        >
                          {event.status}
                          {event.httpStatus === null
                            ? ""
                            : ` ${event.httpStatus}`}
                        </span>
                      </td>
                      <td className="text-xs">{event.source}</td>
                      <td className="text-xs">{event.attempts}</td>
                      <td className="whitespace-nowrap text-xs">
                        {formatDate(event.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SetupNeeded({
  projectId,
  hasDomain,
}: {
  projectId: string;
  hasDomain: boolean;
}) {
  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body gap-2">
        <h2 className="card-title text-base">IndexNow isn&apos;t set up yet</h2>
        <p className="text-sm text-base-content/60">
          {hasDomain
            ? "Generate a key and publish its verification file, then come back here to submit URLs."
            : "Add a domain to this project first, then generate an IndexNow key."}
        </p>
        <div>
          <Link
            to="/p/$projectId/settings"
            params={{ projectId }}
            hash="indexnow"
            className="btn btn-primary btn-sm"
          >
            Open project settings
          </Link>
        </div>
      </div>
    </div>
  );
}
