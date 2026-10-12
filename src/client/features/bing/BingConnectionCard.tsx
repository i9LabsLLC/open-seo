import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { IntegrationConnectionCard } from "@/client/features/bing/IntegrationConnectionCard";
import {
  disconnectBing,
  getBingConnection,
  listBingSites,
  setBingSite,
  startSelfHostedBingLink,
} from "@/serverFunctions/bing";

const connectionKey = (projectId: string) => ["bingConnection", projectId];

/**
 * Bing Webmaster connection for a project. Two ways in: a per-user OAuth grant,
 * or an instance-wide Webmaster API key set by the operator — the latter needs
 * no browser round trip, so the picker is shown immediately when it exists.
 */
export function BingConnectionCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = React.useState(false);
  const [selection, setSelection] = React.useState<{
    accountId: string;
    siteUrl: string;
  } | null>(null);

  const connectionQuery = useQuery({
    queryKey: connectionKey(projectId),
    queryFn: () => getBingConnection({ data: { projectId } }),
  });
  const connection = connectionQuery.data;
  const connected = Boolean(connection?.connected);
  const canConnect = Boolean(
    connection?.currentUserHasGrant || connection?.apiKeyConfigured,
  );
  const showPicker = picking || (canConnect && !connected);

  const sitesQuery = useQuery({
    queryKey: ["bingSites", projectId],
    queryFn: () => listBingSites({ data: { projectId } }),
    enabled: showPicker,
  });
  const accounts = sitesQuery.data?.accounts ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: connectionKey(projectId) });

  const linkMutation = useMutation({
    mutationFn: () =>
      startSelfHostedBingLink({
        data: { callbackURL: window.location.pathname },
      }),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const setSiteMutation = useMutation({
    mutationFn: (selected: { accountId: string; siteUrl: string }) =>
      setBingSite({ data: { projectId, ...selected } }),
    onSuccess: async () => {
      setPicking(false);
      await refresh();
      toast.success("Bing Webmaster connected");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectBing({ data: { projectId } }),
    onSuccess: async () => {
      setPicking(false);
      setSelection(null);
      await refresh();
      toast.success("Bing Webmaster disconnected");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const notConfigured =
    connectionQuery.isSuccess &&
    !connection?.oauthConfigured &&
    !connection?.apiKeyConfigured;

  return (
    <IntegrationConnectionCard
      title="Bing Webmaster"
      status={
        notConfigured
          ? "setup_required"
          : connected
            ? "connected"
            : "disconnected"
      }
    >
      {connectionQuery.isPending ? (
        <span className="loading loading-spinner loading-sm" />
      ) : notConfigured ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Bing Webmaster isn&apos;t set up
          </p>
          <p className="text-sm text-base-content/60">
            Set{" "}
            <code className="font-mono text-xs">BING_WEBMASTER_API_KEY</code>{" "}
            (from Bing Webmaster Tools → Settings → API Access), or configure
            the OAuth client with{" "}
            <code className="font-mono text-xs">BING_CLIENT_ID</code> and{" "}
            <code className="font-mono text-xs">BING_CLIENT_SECRET</code>.
          </p>
        </div>
      ) : connected && !picking ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {connection?.siteUrl}
            </p>
            <p className="text-xs text-base-content/60">
              {connection?.usesApiKey
                ? "Connected with the deployment's API key"
                : "Connected with your Microsoft account"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setPicking(true)}
            >
              Change property
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : showPicker ? (
        <div className="space-y-3">
          {sitesQuery.isPending ? (
            <span className="loading loading-spinner loading-sm" />
          ) : accounts.every((account) => account.sites.length === 0) ? (
            <p className="text-sm text-base-content/60">
              No verified properties are available on the connected account. Add
              and verify the site in Bing Webmaster Tools first.
            </p>
          ) : (
            accounts.map((account) => (
              <div key={account.accountId} className="space-y-1.5">
                {account.requiresReconnect ? (
                  <p className="text-sm text-warning">
                    This connection needs to be re-authorized.
                  </p>
                ) : null}
                {account.sites.map((site) => (
                  <label
                    key={site.siteUrl}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="bing-site"
                      className="radio radio-sm"
                      checked={
                        selection?.siteUrl === site.siteUrl &&
                        selection?.accountId === account.accountId
                      }
                      onChange={() =>
                        setSelection({
                          accountId: account.accountId,
                          siteUrl: site.siteUrl,
                        })
                      }
                    />
                    <span className="truncate font-mono text-xs">
                      {site.siteUrl}
                    </span>
                  </label>
                ))}
              </div>
            ))
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => selection && setSiteMutation.mutate(selection)}
              disabled={!selection || setSiteMutation.isPending}
            >
              Use this property
            </button>
            {connected ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPicking(false)}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-base-content/60">
            Connect Bing Webmaster to read visibility and crawl issues — the
            index behind Copilot and ChatGPT search.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm shrink-0"
            onClick={() => linkMutation.mutate()}
            disabled={linkMutation.isPending}
          >
            Connect
          </button>
        </div>
      )}
    </IntegrationConnectionCard>
  );
}
