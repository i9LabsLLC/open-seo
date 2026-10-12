import { createFileRoute } from "@tanstack/react-router";
import { IndexingPage } from "@/client/features/indexing/IndexingPage";

export const Route = createFileRoute("/_app/p/$projectId/indexing")({
  component: IndexingRoute,
});

function IndexingRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="h-full overflow-auto bg-base-100">
      <IndexingPage projectId={projectId} />
    </div>
  );
}
