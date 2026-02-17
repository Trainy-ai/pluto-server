import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { orgAuthCheck } from "@/lib/auth/check";
import { SettingsLayout } from "@/components/layout/settings/layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ExternalLink, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/settings/org/integrations",
)({
  component: RouteComponent,
  beforeLoad: async ({ params }) => {
    const { auth } = await orgAuthCheck(params.orgSlug);
    return { orgId: auth.activeOrganization.id };
  },
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(
      trpc.organization.integrations.getLinearIntegration.queryOptions({
        organizationId: context.orgId,
      }),
    );
    return { orgId: context.orgId };
  },
});

function RouteComponent() {
  const { orgId } = Route.useLoaderData();

  return (
    <SettingsLayout>
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 p-4 sm:gap-8 sm:p-8">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Integrations</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Connect third-party services to enhance your workflow.
          </p>
        </div>
        <LinearIntegrationCard organizationId={orgId} />
      </div>
    </SettingsLayout>
  );
}

function LinearIntegrationCard({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const { data: integration, isLoading } = useQuery({
    ...trpc.organization.integrations.getLinearIntegration.queryOptions({
      organizationId,
    }),
    refetchOnWindowFocus: false,
  });

  const oauthUrlMutation = useMutation(
    trpc.organization.integrations.getLinearOAuthUrl.mutationOptions(),
  );

  const removeMutation = useMutation(
    trpc.organization.integrations.removeLinearIntegration.mutationOptions(),
  );

  function invalidate() {
    queryClient.invalidateQueries(
      trpc.organization.integrations.getLinearIntegration.queryOptions({ organizationId }),
    );
  }

  function handleConnect() {
    oauthUrlMutation.mutate(
      { organizationId },
      {
        onSuccess: (data) => {
          window.location.href = data.url;
        },
        onError: (err) => {
          toast.error(err.message);
        },
      },
    );
  }

  function handleDisconnect() {
    removeMutation.mutate(
      { organizationId },
      {
        onSuccess: () => {
          toast.success("Linear integration removed");
          setDisconnectOpen(false);
          invalidate();
        },
        onError: (err) => {
          toast.error(err.message);
        },
      },
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <LinearLogo />
            <CardTitle>Linear</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  const isConnected = integration?.configured;
  const isOAuth = integration?.isOAuth;
  const isLegacy = isConnected && !isOAuth;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LinearLogo />
            <div>
              <CardTitle>Linear</CardTitle>
              <CardDescription>
                Link experiments to Linear issues for automatic backlinks and tracking.{" "}
                <a href="https://linear.app/settings/api/applications" target="_blank" rel="noopener noreferrer" className="underline">
                  Set up a Linear OAuth app
                </a>{" "}
                to get started.
              </CardDescription>
            </div>
          </div>
          {isConnected && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Connected
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isConnected ? (
          <div className="space-y-4">
            {isLegacy && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    Legacy API key detected
                  </p>
                  <p className="text-sm text-muted-foreground">
                    This integration uses a personal API key. Re-authenticate with OAuth
                    to ensure reliable syncing across token rotations.
                  </p>
                  <Button
                    size="sm"
                    onClick={handleConnect}
                    disabled={oauthUrlMutation.isPending}
                  >
                    {oauthUrlMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Re-authenticate with OAuth
                  </Button>
                </div>
              </div>
            )}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Workspace</p>
                  <p className="text-sm text-muted-foreground">
                    {integration?.workspaceName ?? integration?.workspaceSlug}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Enabled</span>
                    <Switch checked={integration.enabled} disabled />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Tag runs with <code className="rounded bg-muted px-1.5 py-0.5 text-xs">linear:ISSUE-ID</code> to
              automatically sync experiment data as comments on Linear issues.
            </p>
            <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Disconnect
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Disconnect Linear</DialogTitle>
                  <DialogDescription>
                    This will remove the Linear integration. Existing comments on
                    Linear issues will not be deleted, but no new syncs will occur.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setDisconnectOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDisconnect}
                    disabled={removeMutation.isPending}
                  >
                    {removeMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Disconnect
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect your Linear workspace to automatically sync experiment data
              to Linear issues when runs are tagged.
            </p>
            <Button
              onClick={handleConnect}
              disabled={oauthUrlMutation.isPending}
            >
              {oauthUrlMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              Connect with Linear
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinearLogo() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 100 100"
      fill="currentColor"
      className="shrink-0"
      aria-label="Linear"
    >
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" />
    </svg>
  );
}
