import { describe, it, expect } from "vitest";
import { arePropsEqual } from "../props-comparison";
import type { RunLogType, RunStatus } from "@/lib/grouping/types";

// Helper to create test metrics data
function createMetric(
  name: string,
  type: RunLogType,
  data: Array<{
    runId: string;
    runName: string;
    color: string;
    status: RunStatus;
  }>
) {
  return { name, type, data };
}

// Helper to create test props
function createProps(overrides: Partial<Parameters<typeof arePropsEqual>[0]> = {}) {
  const defaults = {
    title: "Test Group",
    groupId: "test-group-1",
    organizationId: "org-123",
    projectName: "test-project",
    metrics: [
      createMetric("loss", "METRIC", [
        { runId: "run-1", runName: "Run 1", color: "#ff0000", status: "COMPLETED" as RunStatus },
        { runId: "run-2", runName: "Run 2", color: "#00ff00", status: "RUNNING" as RunStatus },
      ]),
    ],
  };
  return { ...defaults, ...overrides };
}

describe("arePropsEqual", () => {
  describe("primitive prop comparisons", () => {
    it("returns true for identical props", () => {
      const props1 = createProps();
      const props2 = createProps();
      expect(arePropsEqual(props1, props2)).toBe(true);
    });

    it("returns false when title changes", () => {
      const props1 = createProps({ title: "Group A" });
      const props2 = createProps({ title: "Group B" });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when groupId changes", () => {
      const props1 = createProps({ groupId: "group-1" });
      const props2 = createProps({ groupId: "group-2" });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when organizationId changes", () => {
      const props1 = createProps({ organizationId: "org-1" });
      const props2 = createProps({ organizationId: "org-2" });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when projectName changes", () => {
      const props1 = createProps({ projectName: "project-a" });
      const props2 = createProps({ projectName: "project-b" });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when className changes", () => {
      const props1 = createProps({ className: "class-a" });
      const props2 = createProps({ className: "class-b" });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });
  });

  describe("metrics array comparisons", () => {
    it("returns false when metrics array length changes", () => {
      const props1 = createProps({
        metrics: [
          createMetric("loss", "METRIC", []),
        ],
      });
      const props2 = createProps({
        metrics: [
          createMetric("loss", "METRIC", []),
          createMetric("accuracy", "METRIC", []),
        ],
      });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when metric name changes", () => {
      const props1 = createProps({
        metrics: [createMetric("loss", "METRIC", [])],
      });
      const props2 = createProps({
        metrics: [createMetric("accuracy", "METRIC", [])],
      });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when metric type changes", () => {
      const props1 = createProps({
        metrics: [createMetric("data", "METRIC", [])],
      });
      const props2 = createProps({
        metrics: [createMetric("data", "HISTOGRAM", [])],
      });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("handles empty metrics arrays", () => {
      const props1 = createProps({ metrics: [] });
      const props2 = createProps({ metrics: [] });
      expect(arePropsEqual(props1, props2)).toBe(true);
    });

    it("returns false when metrics order changes", () => {
      const metric1 = createMetric("loss", "METRIC", []);
      const metric2 = createMetric("accuracy", "METRIC", []);

      const props1 = createProps({ metrics: [metric1, metric2] });
      const props2 = createProps({ metrics: [metric2, metric1] });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });
  });

  describe("run data comparisons", () => {
    it("returns false when run data array length changes", () => {
      const props1 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 1", color: "#ff0000", status: "COMPLETED" },
          ]),
        ],
      });
      const props2 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 1", color: "#ff0000", status: "COMPLETED" },
            { runId: "run-2", runName: "Run 2", color: "#00ff00", status: "RUNNING" },
          ]),
        ],
      });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when run status changes", () => {
      const props1 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 1", color: "#ff0000", status: "RUNNING" },
          ]),
        ],
      });
      const props2 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 1", color: "#ff0000", status: "COMPLETED" },
          ]),
        ],
      });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when run color changes", () => {
      const props1 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 1", color: "#ff0000", status: "COMPLETED" },
          ]),
        ],
      });
      const props2 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 1", color: "#00ff00", status: "COMPLETED" },
          ]),
        ],
      });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when runId changes", () => {
      const props1 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 1", color: "#ff0000", status: "COMPLETED" },
          ]),
        ],
      });
      const props2 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-2", runName: "Run 1", color: "#ff0000", status: "COMPLETED" },
          ]),
        ],
      });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("returns false when runName changes", () => {
      const props1 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 1", color: "#ff0000", status: "COMPLETED" },
          ]),
        ],
      });
      const props2 = createProps({
        metrics: [
          createMetric("loss", "METRIC", [
            { runId: "run-1", runName: "Run 2", color: "#ff0000", status: "COMPLETED" },
          ]),
        ],
      });
      expect(arePropsEqual(props1, props2)).toBe(false);
    });

    it("handles empty run data arrays", () => {
      const props1 = createProps({
        metrics: [createMetric("loss", "METRIC", [])],
      });
      const props2 = createProps({
        metrics: [createMetric("loss", "METRIC", [])],
      });
      expect(arePropsEqual(props1, props2)).toBe(true);
    });
  });

  describe("complex scenarios", () => {
    it("returns true for deeply identical complex props", () => {
      const runs = [
        { runId: "run-1", runName: "Training Run 1", color: "#ff0000", status: "COMPLETED" as RunStatus },
        { runId: "run-2", runName: "Training Run 2", color: "#00ff00", status: "RUNNING" as RunStatus },
        { runId: "run-3", runName: "Training Run 3", color: "#0000ff", status: "FAILED" as RunStatus },
      ];

      const metrics = [
        createMetric("train/loss", "METRIC", runs),
        createMetric("train/accuracy", "METRIC", runs),
        createMetric("val/loss", "METRIC", runs),
        createMetric("histogram/weights", "HISTOGRAM", runs),
      ];

      const props1 = createProps({ metrics });
      const props2 = createProps({ metrics: [...metrics] }); // Shallow copy of metrics array

      expect(arePropsEqual(props1, props2)).toBe(true);
    });

    it("handles all run statuses correctly", () => {
      const statuses: RunStatus[] = ["RUNNING", "COMPLETED", "FAILED", "TERMINATED", "CANCELLED"];

      for (const status of statuses) {
        const props1 = createProps({
          metrics: [
            createMetric("loss", "METRIC", [
              { runId: "run-1", runName: "Run 1", color: "#ff0000", status },
            ]),
          ],
        });
        const props2 = createProps({
          metrics: [
            createMetric("loss", "METRIC", [
              { runId: "run-1", runName: "Run 1", color: "#ff0000", status },
            ]),
          ],
        });
        expect(arePropsEqual(props1, props2)).toBe(true);
      }
    });

    it("handles all metric types correctly", () => {
      const types: RunLogType[] = ["METRIC", "HISTOGRAM", "AUDIO", "IMAGE", "VIDEO"];

      for (const type of types) {
        const props1 = createProps({
          metrics: [createMetric("test-metric", type, [])],
        });
        const props2 = createProps({
          metrics: [createMetric("test-metric", type, [])],
        });
        expect(arePropsEqual(props1, props2)).toBe(true);
      }
    });
  });
});
