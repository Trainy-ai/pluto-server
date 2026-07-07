import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Isolate StatusIndicator from the rest of the sidebar module's import graph
// (tRPC client, better-auth client, latest-runs query) so the test stays a
// pure render test.
vi.mock("@/utils/trpc", () => ({ trpc: {} }));
vi.mock("@/lib/auth/client", () => ({ useAuth: () => ({ data: undefined }) }));
vi.mock("../queries", () => ({
  useLatestRuns: () => ({ data: [], isLoading: false }),
}));

// jsdom can't drive Radix tooltip portals/pointer events — render children
// inline so we can assert what the indicator itself renders.
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    DocsTooltip: Pass,
    Tooltip: Pass,
    TooltipContent: Pass,
    TooltipProvider: Pass,
    TooltipTrigger: Pass,
    UnstyledTooltipContent: Pass,
  };
});

import { StatusIndicator } from "../sidebar";

const FINAL_STATES = ["COMPLETED", "FAILED", "TERMINATED", "CANCELLED"] as const;

describe("StatusIndicator", () => {
  afterEach(cleanup);

  it("renders the pulsing live indicator for RUNNING", () => {
    render(<StatusIndicator status="RUNNING" />);
    expect(screen.queryByTestId("running-indicator")).not.toBeNull();
  });

  for (const status of FINAL_STATES) {
    it(`renders no colored status dot for ${status}`, () => {
      const { container } = render(<StatusIndicator status={status} />);
      // No live indicator for a finished run…
      expect(screen.queryByTestId("running-indicator")).toBeNull();
      // …and crucially no colored dot at all — just an aria-hidden spacer that
      // keeps run names aligned. This is the "no rainbow of dots" guarantee.
      expect(container.querySelector('[class*="bg-"]')).toBeNull();
      expect(container.querySelector("[aria-hidden]")).not.toBeNull();
    });
  }
});
