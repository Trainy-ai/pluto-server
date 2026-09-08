import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MergeRunsButton } from "../merge-runs-button";
import type { Run } from "../../../../~queries/list-runs";

const mutateMerge = vi.fn();
const mutateUnmerge = vi.fn();

vi.mock("../../../../~queries/merge-runs", () => ({
  useMergeRuns: () => ({ mutate: mutateMerge, isPending: false }),
  useUnmergeRun: () => ({ mutate: mutateUnmerge, isPending: false }),
}));

afterEach(() => {
  cleanup();
  mutateMerge.mockReset();
  mutateUnmerge.mockReset();
});

function makeRun(
  id: string,
  name: string,
  createdAt: string,
  extras: Partial<Run> = {}
): Run {
  return {
    id,
    name,
    status: "COMPLETED",
    createdAt,
    forkedFromRunId: null,
    ...extras,
  } as unknown as Run;
}

function selected(
  runs: Run[]
): Record<string, { run: Run; color: string }> {
  return Object.fromEntries(runs.map((run) => [run.id, { run, color: "#000" }]));
}

const defaultProps = {
  organizationId: "org-1",
  projectName: "proj",
};

describe("MergeRunsButton", () => {
  it("is disabled when fewer than 2 runs are selected", () => {
    render(
      <MergeRunsButton {...defaultProps} selectedRunsWithColors={selected([])} />
    );
    expect(screen.getByTestId("merge-runs-btn")).toHaveProperty("disabled", true);

    cleanup();
    const one = makeRun("a", "only", "2026-08-27T09:00:00Z");
    render(
      <MergeRunsButton
        {...defaultProps}
        selectedRunsWithColors={selected([one])}
      />
    );
    expect(screen.getByTestId("merge-runs-btn")).toHaveProperty("disabled", true);
  });

  it("is disabled when more than 10 runs are selected", () => {
    const runs = Array.from({ length: 11 }, (_, i) =>
      makeRun(String(i), `run-${i}`, `2026-08-27T09:${String(i).padStart(2, "0")}:00Z`)
    );
    render(
      <MergeRunsButton
        {...defaultProps}
        selectedRunsWithColors={selected(runs)}
      />
    );
    expect(screen.getByTestId("merge-runs-btn")).toHaveProperty("disabled", true);
  });

  it("opens a dialog ordered by createdAt with a continues-as chain", () => {
    const restart = makeRun("b", "restarted-training", "2026-08-27T11:40:00Z");
    const crashed = makeRun("a", "crashed-training", "2026-08-27T09:12:00Z");
    render(
      <MergeRunsButton
        {...defaultProps}
        selectedRunsWithColors={selected([restart, crashed])}
      />
    );

    const btn = screen.getByTestId("merge-runs-btn");
    expect(btn).toHaveProperty("disabled", false);
    fireEvent.click(btn);

    const dialog = screen.getByTestId("merge-runs-dialog");
    expect(dialog).toBeDefined();
    expect(dialog.textContent).toMatch(/crashed-training[\s\S]*continues as[\s\S]*restarted-training/);
  });

  it("calls merge with selected run ids on confirm", () => {
    const crashed = makeRun("a", "crashed-training", "2026-08-27T09:12:00Z");
    const restart = makeRun("b", "restarted-training", "2026-08-27T11:40:00Z");
    render(
      <MergeRunsButton
        {...defaultProps}
        selectedRunsWithColors={selected([crashed, restart])}
      />
    );
    fireEvent.click(screen.getByTestId("merge-runs-btn"));
    fireEvent.click(screen.getByTestId("confirm-merge-runs-btn"));

    expect(mutateMerge).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        projectName: "proj",
        runIds: ["a", "b"],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("shows Unlink for an already-linked run and calls unmerge", () => {
    const crashed = makeRun("a", "crashed-training", "2026-08-27T09:12:00Z");
    const restart = makeRun("b", "restarted-training", "2026-08-27T11:40:00Z", {
      forkedFromRunId: "a",
    });
    render(
      <MergeRunsButton
        {...defaultProps}
        selectedRunsWithColors={selected([crashed, restart])}
      />
    );
    fireEvent.click(screen.getByTestId("merge-runs-btn"));

    expect(screen.getByText("Already linked")).toBeDefined();
    fireEvent.click(screen.getByTestId("unlink-run-b"));
    expect(mutateUnmerge).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectName: "proj",
      runId: "b",
    });
  });
});
