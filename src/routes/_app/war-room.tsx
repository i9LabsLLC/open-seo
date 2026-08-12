import { createFileRoute } from "@tanstack/react-router";
import {
  BingTelemetrySection,
  IndexNowTelemetrySection,
} from "@/client/features/war-room/WarRoomTelemetry";

export const Route = createFileRoute("/_app/war-room")({
  component: WarRoomPage,
});

// Org-wide indexing view: which projects can push to IndexNow, how their
// submissions landed, and what Bing is currently unable to crawl. Everything
// here is per-project elsewhere; this is the one screen that answers "is
// anything broken anywhere?".
function WarRoomPage() {
  return (
    <div className="h-full overflow-auto bg-base-100">
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 py-8 sm:p-6 md:py-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">War room</h1>
          <p className="text-sm text-base-content/60">
            Indexing health across every project in this workspace.
          </p>
        </div>
        <IndexNowTelemetrySection />
        <BingTelemetrySection />
      </div>
    </div>
  );
}
