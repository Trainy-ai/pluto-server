import { describe, it, expect, beforeEach } from "vitest";
import { groupMetrics } from "./metrics-utils";

// Mock run type matching the expected structure
interface MockRun {
  id: string;
  name: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "CANCELLED";
}

// Mock log type
interface MockLog {
  logName: string;
  logGroup: string | null;
  logType: string;
}

// Helper to create mock run
function createMockRun(id: string, name: string, status: MockRun["status"] = "COMPLETED"): MockRun {
  return { id, name, status };
}

// Helper to create mock log
function createMockLog(logName: string, logType: string, logGroup: string | null = null): MockLog {
  return { logName, logGroup, logType };
}

// Helper to create selectedRunsWithColors
// Uses 'as any' cast since we only need id, name, and status for groupMetrics logic
function createSelectedRuns(runs: MockRun[], colors: string[]) {
  return runs.reduce(
    (acc, run, i) => {
      acc[run.id] = { run: run as any, color: colors[i] || "#000000" };
      return acc;
    },
    {} as Record<string, { run: any; color: string }>,
  );
}

describe("groupMetrics", () => {
  const orgId = "test-org";
  const projectName = "test-project";

  beforeEach(() => {
    // Clear the module-level cache between tests by using different org/project combos
    // or by accepting that cache may affect tests (realistic behavior)
  });

  describe("basic functionality", () => {
    it("returns empty groups when logsByRunId is undefined", () => {
      const runs = [createMockRun("run1", "Run 1")];
      const selectedRuns = createSelectedRuns(runs, ["#ff0000"]);

      const result = groupMetrics(selectedRuns, undefined, orgId, projectName);

      expect(result).toEqual({});
    });

    it("returns empty groups when logsByRunId is empty object", () => {
      const runs = [createMockRun("run1", "Run 1")];
      const selectedRuns = createSelectedRuns(runs, ["#ff0000"]);

      const result = groupMetrics(selectedRuns, {}, orgId, "empty-logs-project");

      expect(result).toEqual({});
    });

    it("groups METRIC logs by group name", () => {
      const runs = [createMockRun("run1", "Run 1")];
      const selectedRuns = createSelectedRuns(runs, ["#ff0000"]);
      const logsByRunId = {
        run1: [
          createMockLog("loss", "METRIC", "training"),
          createMockLog("accuracy", "METRIC", "training"),
        ],
      };

      const result = groupMetrics(selectedRuns, logsByRunId as any, orgId, "metric-grouping-project");

      expect(result).toHaveProperty("training");
      expect(result["training"].metrics).toHaveLength(2);
      expect(result["training"].metrics.map((m) => m.name)).toContain("loss");
      expect(result["training"].metrics.map((m) => m.name)).toContain("accuracy");
    });
  });

  describe("media types second pass", () => {
    it("includes all selected runs in IMAGE metrics even if their logs are not loaded", () => {
      // Run 1 has IMAGE log, Run 2 does not
      const run1 = createMockRun("run1", "Run 1");
      const run2 = createMockRun("run2", "Run 2");
      const selectedRuns = createSelectedRuns([run1, run2], ["#ff0000", "#00ff00"]);

      // Only run1 has logs loaded
      const logsByRunId = {
        run1: [createMockLog("media/samples", "IMAGE", "media")],
        // run2 has no IMAGE log (simulating logs not loaded yet)
        run2: [createMockLog("loss", "METRIC", "training")],
      };

      const result = groupMetrics(selectedRuns, logsByRunId as any, orgId, "image-second-pass-project");

      // Find the IMAGE metric
      const mediaGroup = result["media"];
      expect(mediaGroup).toBeDefined();

      const imageMetric = mediaGroup.metrics.find((m) => m.type === "IMAGE");
      expect(imageMetric).toBeDefined();

      // Both runs should be in the IMAGE metric data
      const runIds = imageMetric!.data.map((d) => d.runId);
      expect(runIds).toContain("run1");
      expect(runIds).toContain("run2");
    });

    it("includes all selected runs in AUDIO metrics", () => {
      const run1 = createMockRun("run1", "Run 1");
      const run2 = createMockRun("run2", "Run 2");
      const selectedRuns = createSelectedRuns([run1, run2], ["#ff0000", "#00ff00"]);

      const logsByRunId = {
        run1: [createMockLog("audio/samples", "AUDIO", "audio")],
        run2: [], // No logs for run2
      };

      const result = groupMetrics(selectedRuns, logsByRunId as any, orgId, "audio-second-pass-project");

      const audioGroup = result["audio"];
      expect(audioGroup).toBeDefined();

      const audioMetric = audioGroup.metrics.find((m) => m.type === "AUDIO");
      expect(audioMetric).toBeDefined();

      const runIds = audioMetric!.data.map((d) => d.runId);
      expect(runIds).toContain("run1");
      expect(runIds).toContain("run2");
    });

    it("includes all selected runs in VIDEO metrics", () => {
      const run1 = createMockRun("run1", "Run 1");
      const run2 = createMockRun("run2", "Run 2");
      const selectedRuns = createSelectedRuns([run1, run2], ["#ff0000", "#00ff00"]);

      const logsByRunId = {
        run1: [createMockLog("video/training", "VIDEO", "video")],
        run2: [],
      };

      const result = groupMetrics(selectedRuns, logsByRunId as any, orgId, "video-second-pass-project");

      const videoGroup = result["video"];
      expect(videoGroup).toBeDefined();

      const videoMetric = videoGroup.metrics.find((m) => m.type === "VIDEO");
      expect(videoMetric).toBeDefined();

      const runIds = videoMetric!.data.map((d) => d.runId);
      expect(runIds).toContain("run1");
      expect(runIds).toContain("run2");
    });

    it("does NOT add extra runs to non-media METRIC types", () => {
      const run1 = createMockRun("run1", "Run 1");
      const run2 = createMockRun("run2", "Run 2");
      const selectedRuns = createSelectedRuns([run1, run2], ["#ff0000", "#00ff00"]);

      // Only run1 has the METRIC log
      const logsByRunId = {
        run1: [createMockLog("loss", "METRIC", "training")],
        run2: [], // run2 has no logs
      };

      const result = groupMetrics(selectedRuns, logsByRunId as any, orgId, "metric-no-second-pass-project");

      const trainingGroup = result["training"];
      expect(trainingGroup).toBeDefined();

      const metricData = trainingGroup.metrics.find((m) => m.name === "loss");
      expect(metricData).toBeDefined();

      // Only run1 should be in the METRIC data (no second pass for non-media types)
      const runIds = metricData!.data.map((d) => d.runId);
      expect(runIds).toContain("run1");
      expect(runIds).not.toContain("run2");
    });
  });

  describe("cache behavior", () => {
    it("returns same reference when called with identical inputs", () => {
      const runs = [createMockRun("run1", "Run 1")];
      const selectedRuns = createSelectedRuns(runs, ["#ff0000"]);
      const logsByRunId = {
        run1: [createMockLog("loss", "METRIC", "training")],
      };

      const cacheTestProject = "cache-test-project-" + Date.now();

      const result1 = groupMetrics(selectedRuns, logsByRunId as any, orgId, cacheTestProject);
      const result2 = groupMetrics(selectedRuns, logsByRunId as any, orgId, cacheTestProject);

      // Should return the exact same object reference (cached)
      expect(result1).toBe(result2);
    });

    it("returns different reference when inputs change", () => {
      const runs = [createMockRun("run1", "Run 1")];
      const selectedRuns1 = createSelectedRuns(runs, ["#ff0000"]);
      const selectedRuns2 = createSelectedRuns(runs, ["#00ff00"]); // Different color
      const logsByRunId = {
        run1: [createMockLog("loss", "METRIC", "training")],
      };

      const cacheChangeProject = "cache-change-project-" + Date.now();

      const result1 = groupMetrics(selectedRuns1, logsByRunId as any, orgId, cacheChangeProject);
      const result2 = groupMetrics(selectedRuns2, logsByRunId as any, orgId, cacheChangeProject);

      // Should return different object references
      expect(result1).not.toBe(result2);
    });
  });

  describe("run data in output", () => {
    it("includes correct color and status for each run", () => {
      const run1 = createMockRun("run1", "Run 1", "RUNNING");
      const run2 = createMockRun("run2", "Run 2", "COMPLETED");
      const selectedRuns = createSelectedRuns([run1, run2], ["#ff0000", "#00ff00"]);

      const logsByRunId = {
        run1: [createMockLog("media/samples", "IMAGE", "media")],
        run2: [createMockLog("media/samples", "IMAGE", "media")],
      };

      const result = groupMetrics(selectedRuns, logsByRunId as any, orgId, "run-data-project");

      const imageMetric = result["media"].metrics.find((m) => m.type === "IMAGE");
      const run1Data = imageMetric!.data.find((d) => d.runId === "run1");
      const run2Data = imageMetric!.data.find((d) => d.runId === "run2");

      expect(run1Data).toMatchObject({
        runId: "run1",
        runName: "Run 1",
        color: "#ff0000",
        status: "RUNNING",
      });

      expect(run2Data).toMatchObject({
        runId: "run2",
        runName: "Run 2",
        color: "#00ff00",
        status: "COMPLETED",
      });
    });
  });
});
