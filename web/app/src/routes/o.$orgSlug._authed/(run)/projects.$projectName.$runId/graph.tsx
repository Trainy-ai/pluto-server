import { queryClient, trpc } from "@/utils/trpc";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { RunNotFound } from "@/components/layout/run/not-found";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { prefetchGetRun, useGetRun } from "./~queries/get-run";
import { Layout } from "./~components/layout";
import GraphFlow from "./~components/model-graph";
import {
  HelpCircle,
  ExternalLink,
  Maximize2,
  Minimize2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import CodeBlock from "@/components/ui/code-block";

export const Route = createFileRoute(
  "/o/$orgSlug/_authed/(run)/projects/$projectName/$runId/graph",
)({
  errorComponent: RunNotFound,
  beforeLoad: async ({ context, params }) => {
    const auth = context.auth;

    await prefetchGetRun(
      auth.activeOrganization.id,
      params.projectName,
      params.runId,
    );

    queryClient.prefetchQuery(
      trpc.runs.data.modelGraph.queryOptions({
        organizationId: auth.activeOrganization.id,
        runId: params.runId,
      }),
    );

    return {
      organizationId: auth.activeOrganization.id,
      projectName: params.projectName,
      runId: params.runId,
    };
  },
  component: RouteComponent,
});

function ModelGraphHelpDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Model Graph Help</DialogTitle>
          <DialogDescription>
            Understanding the model graph visualization
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <h3 className="text-sm font-semibold">Navigation</h3>
            <p className="text-sm text-muted-foreground">
              Click and drag to pan the graph. Use the mouse wheel to zoom in
              and out.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Nodes</h3>
            <p className="text-sm text-muted-foreground">
              Nodes represent different components of your model. Click on a
              node to see the parameters and gradients evolving over time.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Connections</h3>
            <p className="text-sm text-muted-foreground">
              Solid lines between nodes show the parent-child relationship and
              dotted lines show the data flow between nodes.
            </p>
          </div>
          <div className="flex items-center justify-between pt-2">
            <a
              href="https://docs.mlop.ai/docs/experiments/visualizations/model-graph"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-0.5 rounded-md bg-muted px-2 py-1 text-xs font-medium transition-colors hover:bg-accent/80"
            >
              Docs
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelGraphMissingInfo() {
  const codeExample = `mlop.watch(model)`;

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Card className="w-full max-w-7xl shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-2xl">
                No Model Graph Available
              </CardTitle>
              <span className="ml-2 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400">
                PyTorch Only
              </span>
            </div>
          </div>
          <CardDescription className="text-base">
            Model graphs provide a visual representation of your ML model's
            architecture
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8">
          <div className="flex divide-x divide-border overflow-hidden rounded-xl border border-border shadow-sm">
            {/* Left side: Text content */}
            <div className="w-1/2 space-y-8 p-10">
              <div className="space-y-3">
                <h3 className="text-xl font-medium text-primary">
                  What is a Model Graph?
                </h3>
                <p className="leading-relaxed text-muted-foreground">
                  A model graph visualizes the structure and data flow of your
                  machine learning model. It shows the layers, nodes, and
                  connections that make up your model architecture, helping you
                  understand how data flows through your model.
                </p>
                <p className="leading-relaxed text-muted-foreground">
                  You are also able to see how the gradients and parameters in
                  each layer evolve over time. Helping you identify bottlenecks
                  like exploding gradients.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-medium text-primary">
                    Only 1 line of code needed
                  </h3>
                </div>
                <CodeBlock
                  code={codeExample}
                  language="python"
                  fontSize="sm"
                  showLineNumbers={false}
                />
              </div>

              <Button variant="secondary" size="lg">
                <a
                  href="https://docs.mlop.ai/docs/experiments/visualizations/model-graph"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  <span>View Documentation</span>
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>

            {/* Right side: Image placeholder */}
            <div className="flex w-1/2 flex-col items-center justify-center p-10">
              <p className="text-xl font-medium text-primary">
                Model Graph Visualization
              </p>
              <p className="mt-2 text-muted-foreground">
                A visual representation of your model
              </p>
              <div className="mt-8 flex h-[300px] w-full items-center justify-center rounded-lg bg-muted/20">
                {/* Placeholder for future GIF/image */}
                <img
                  src="/assets/model-graph.gif"
                  alt="Model Graph"
                  className="h-full w-full object-contain"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RouteComponent() {
  const { projectName, runId, organizationId } = Route.useRouteContext();
  const [isFullScreen, setIsFullScreen] = useState(false);

  const { data: currentRun, isLoading } = useGetRun(
    organizationId,
    projectName,
    runId,
  );

  const { data: modelGraph, isLoading: isModelGraphLoading } = useQuery(
    trpc.runs.data.modelGraph.queryOptions({
      organizationId,
      runId,
    }),
  );

  const toggleFullScreen = () => {
    setIsFullScreen(!isFullScreen);
  };

  if (isFullScreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <div className="absolute top-4 right-4 z-50 flex gap-2">
          <ModelGraphHelpDialog />
          <Button
            variant="outline"
            size="icon"
            onClick={toggleFullScreen}
            className="h-8 w-8"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
        {isLoading || isModelGraphLoading ? (
          <Skeleton className="h-full w-full" />
        ) : modelGraph ? (
          <GraphFlow
            runId={runId}
            orgId={organizationId}
            projectName={projectName}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ModelGraphMissingInfo />
          </div>
        )}
      </div>
    );
  }

  return (
    <Layout
      run={currentRun}
      projectName={projectName}
      runId={runId}
      title="Summary"
      organizationId={organizationId}
    >
      <div className="flex h-[calc(100vh-theme(spacing.16))] flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Model Graph</h1>
            <ModelGraphHelpDialog />
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://docs.mlop.ai/docs/experiments/visualizations/model-graph"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-muted px-3 text-sm font-medium transition-colors hover:bg-accent/80"
            >
              <span>Docs</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleFullScreen}
              className="h-8 w-8"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {isLoading || isModelGraphLoading ? (
          <Skeleton className="h-full w-full" />
        ) : modelGraph ? (
          <div className="h-full w-full">
            <GraphFlow
              runId={runId}
              orgId={organizationId}
              projectName={projectName}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <ModelGraphMissingInfo />
          </div>
        )}
      </div>
    </Layout>
  );
}
