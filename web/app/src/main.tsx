import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link, RouterProvider, createRouter } from "@tanstack/react-router";

import ReactDOM from "react-dom/client";
import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";
import { queryClient, trpc } from "./utils/trpc";
import { Button } from "@/components/ui/button";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  notFoundMode: "root",
  context: { auth: null, queryClient },
  defaultPendingComponent: () => <Loader />,
  defaultErrorComponent: (e) => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <h1 className="text-9xl font-bold">Error</h1>
      <pre className="text-3xl text-muted-foreground">
        {JSON.stringify(e.error, null, 2)}
      </pre>
      <pre className="text-3xl text-muted-foreground">
        {JSON.stringify(e.info?.componentStack, null, 2)}
      </pre>
      <Button
        onClick={e.reset}
        className="mt-6 text-sm text-muted-foreground underline underline-offset-4"
      >
        Retry
      </Button>
    </div>
  ),
  defaultNotFoundComponent: () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <h1 className="text-9xl font-bold">404</h1>
      <p className="text-3xl text-muted-foreground">Page not found</p>
      <Link
        to="/"
        className="mt-6 text-sm text-muted-foreground underline underline-offset-4"
      >
        Go to home
      </Link>
    </div>
  ),
});

const AuthRouter = ({ router }: { router: RouterType }) => {
  const { data: auth } = useQuery(trpc.auth.queryOptions());

  return <RouterProvider router={router} context={{ auth }} />;
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthRouter router={router} />
    </QueryClientProvider>
  );
};

const rootElement = document.getElementById("app")!;

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}

type RouterType = typeof router;
// Register things for typesafety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
