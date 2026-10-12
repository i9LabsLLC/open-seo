import { queryClient } from "@/client/tanstack-db/queryClient";
import { googleConnectionOptions } from "@/client/features/integrations/googleProviders";
import { createFileRoute } from "@tanstack/react-router";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { CrawlerAccessSettings } from "@/client/features/settings/CrawlerAccessSettings";
import { useQuery } from "@tanstack/react-query";
import { QueryState } from "@/client/components/QueryState";
import { BingConnectionCard } from "@/client/features/bing/BingConnectionCard";
import { IndexNowCard } from "@/client/features/projects/IndexNowCard";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";

export const Route = createFileRoute(
  "/_app/p/$projectId/settings/integrations",
)({
  loader: ({ params }) => {
    // Start both database checks on link intent without holding up navigation.
    void queryClient.prefetchQuery(
      googleConnectionOptions("gsc", params.projectId),
    );
    void queryClient.prefetchQuery(
      googleConnectionOptions("ga4", params.projectId),
    );
  },
  component: ProjectIntegrationsRoute,
});

function ProjectIntegrationsRoute() {
  const { projectId } = Route.useParams();

  return (
    <div className="space-y-8">
      {/* The ids are the targets old #search-console / #google-analytics deep
          links are redirected to from the settings index. Each card's title
          names its integration, so the sections carry no heading. */}
      <section id="search-console" className="scroll-mt-6">
        <GoogleConnectionCard provider="gsc" projectId={projectId} />
      </section>

      <section id="google-analytics" className="scroll-mt-6">
        <GoogleConnectionCard provider="ga4" projectId={projectId} />
      </section>

      <section id="bing" className="scroll-mt-6 space-y-3">
        <h2 className="text-sm font-medium text-base-content/50">
          Bing Webmaster
        </h2>
        <BingConnectionCard projectId={projectId} />
      </section>

      <section id="indexnow" className="scroll-mt-6 space-y-3">
        <h2 className="text-sm font-medium text-base-content/50">IndexNow</h2>
        <ProjectIndexNowCard projectId={projectId} />
      </section>

      <CrawlerAccessSettings projectId={projectId} />
    </div>
  );
}

// IndexNowCard edits the project's stored key, so it needs the full project.
function ProjectIndexNowCard({ projectId }: { projectId: string }) {
  const projectsQuery = useQuery(projectsQueryOptions());
  return (
    <QueryState
      query={projectsQuery}
      errorFallback="Failed to load the project"
    >
      {(projects) => {
        const project = projects.find((entry) => entry.id === projectId);
        return project ? <IndexNowCard project={project} /> : null;
      }}
    </QueryState>
  );
}
