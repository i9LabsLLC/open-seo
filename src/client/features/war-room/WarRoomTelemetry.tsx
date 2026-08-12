import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import {
  getWarRoomBingTelemetry,
  getWarRoomIndexingTelemetry,
} from "@/serverFunctions/war-room";
import { describeIndexNowStatus } from "@/shared/indexnow";

const indexingKey = ["warRoomIndexing"];
const bingKey = ["warRoomBing"];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function SectionShell({
  title,
  description,
  onRefresh,
  children,
}: {
  title: string;
  description: string;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
      <div className="flex items-start justify-between gap-4 border-b border-base-300 px-4 py-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-base-content/60">{description}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1"
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </button>
      </div>
      {children}
    </section>
  );
}

export function IndexNowTelemetrySection() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: indexingKey,
    queryFn: () => getWarRoomIndexingTelemetry(),
  });

  return (
    <SectionShell
      title="IndexNow"
      description="Setup and submission results across every active project"
      onRefresh={() =>
        void queryClient.invalidateQueries({ queryKey: indexingKey })
      }
    >
      {query.isPending ? (
        <div className="p-8 text-center">
          <span className="loading loading-spinner loading-sm" />
        </div>
      ) : (query.data?.projects.length ?? 0) === 0 ? (
        <div className="p-8 text-center text-sm text-base-content/60">
          No project has an IndexNow key yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Project</th>
                <th>Host</th>
                <th>State</th>
                <th>Submitted</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.projects.map((project) => (
                <tr key={project.projectId}>
                  <td>
                    <Link
                      to="/p/$projectId/indexing"
                      params={{ projectId: project.projectId }}
                      className="link link-hover font-medium"
                    >
                      {project.projectName}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{project.host ?? "—"}</td>
                  <td className="space-x-1">
                    <span
                      className={`badge badge-sm ${
                        project.enabled ? "badge-success" : "badge-ghost"
                      }`}
                    >
                      {project.enabled ? "enabled" : "paused"}
                    </span>
                    <span
                      className={`badge badge-sm ${
                        project.verified ? "badge-success" : "badge-warning"
                      }`}
                      title={
                        project.verified
                          ? "The key file was confirmed live"
                          : "The key file hasn't been confirmed — engines answer 403 until it is"
                      }
                    >
                      {project.verified ? "verified" : "unverified"}
                    </span>
                  </td>
                  <td>{project.counts.success}</td>
                  <td>{project.counts.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(query.data?.recentEvents.length ?? 0) > 0 ? (
        <div className="border-t border-base-300">
          <p className="px-4 py-2 text-xs font-medium text-base-content/50">
            Recent activity
          </p>
          <div className="max-h-80 overflow-auto">
            <table className="table table-sm">
              <tbody>
                {query.data?.recentEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap text-xs">
                      {event.projectName}
                    </td>
                    <td className="max-w-xs truncate font-mono text-xs">
                      {event.url}
                    </td>
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
                        {event.eventType}
                      </span>
                    </td>
                    <td className="text-xs">{event.source}</td>
                    <td className="whitespace-nowrap text-xs">
                      {formatDate(event.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </SectionShell>
  );
}

export function BingTelemetrySection() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: bingKey,
    queryFn: () => getWarRoomBingTelemetry(),
  });

  return (
    <SectionShell
      title="Bing crawl issues"
      description="Live from Bing Webmaster for every connected project"
      onRefresh={() =>
        void queryClient.invalidateQueries({ queryKey: bingKey })
      }
    >
      {query.isPending ? (
        <div className="p-8 text-center">
          <span className="loading loading-spinner loading-sm" />
        </div>
      ) : (query.data?.projects.length ?? 0) === 0 ? (
        <div className="p-8 text-center text-sm text-base-content/60">
          No project has Bing Webmaster connected yet.
        </div>
      ) : (
        <ul className="divide-y divide-base-300">
          {query.data?.projects.map((project) => (
            <li key={project.projectId} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{project.projectName}</span>
                {project.error ? (
                  <span className="badge badge-error badge-sm">
                    unavailable
                  </span>
                ) : (
                  <span
                    className={`badge badge-sm ${
                      project.issueCount === 0
                        ? "badge-success"
                        : "badge-warning"
                    }`}
                  >
                    {project.issueCount} issue
                    {project.issueCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <p className="truncate font-mono text-xs text-base-content/60">
                {project.siteUrl}
              </p>
              {project.error ? (
                <p className="text-xs text-error">{project.error}</p>
              ) : (
                <ul className="space-y-0.5">
                  {project.issueSample.map((issue) => (
                    <li
                      key={issue}
                      className="truncate font-mono text-xs text-base-content/60"
                    >
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {(query.data?.notQueried ?? 0) > 0 ? (
        <p className="border-t border-base-300 px-4 py-2 text-xs text-base-content/50">
          {query.data?.notQueried} more connected project(s) weren&apos;t
          queried — open them individually to see their issues.
        </p>
      ) : null}
    </SectionShell>
  );
}
