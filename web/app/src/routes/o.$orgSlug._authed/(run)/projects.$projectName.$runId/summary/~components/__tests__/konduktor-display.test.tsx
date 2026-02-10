import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { KonduktorDisplay } from "../konduktor-display";

// Mock run object factory
function makeRun(overrides?: Partial<{
  createdAt: Date;
  updatedAt: Date;
  status: "RUNNING" | "COMPLETED" | "TERMINATED" | "FAILED" | "CANCELLED";
}>) {
  return {
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T04:00:00Z"),
    status: "COMPLETED" as const,
    ...overrides,
  };
}

// Full Konduktor systemMetadata fixture
const fullKonduktorMetadata = {
  konduktor: {
    job_name: "my-training-run-abc1",
    num_nodes: "4",
    num_gpus_per_node: "8",
    total_gpus: 32,
    rank: "0",
    master_addr: "my-training-run-abc1-workers-0-0.my-training-run-abc1",
    accelerator_type: "H100",
    node_name: "gke-a100-pool-abc12",
    restart_attempt: "0",
    namespace: "team-ml",
  },
};

describe("KonduktorDisplay", () => {
  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("returns null when systemMetadata has no konduktor key", () => {
      const { container } = render(
        <KonduktorDisplay
          systemMetadata={{ gpu: { nvidia: {} } }}
          run={makeRun()}
        />,
      );
      expect(container.innerHTML).toBe("");
    });

    it("returns null when systemMetadata is null", () => {
      const { container } = render(
        <KonduktorDisplay systemMetadata={null} run={makeRun()} />,
      );
      expect(container.innerHTML).toBe("");
    });

    it("returns null when systemMetadata is undefined", () => {
      const { container } = render(
        <KonduktorDisplay systemMetadata={undefined} run={makeRun()} />,
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders the card when valid konduktor data is present", () => {
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun()}
        />,
      );
      expect(screen.getByText("Konduktor Job")).toBeDefined();
    });

    it("renders job name", () => {
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun()}
        />,
      );
      expect(screen.getByText("my-training-run-abc1")).toBeDefined();
    });

    it("renders accelerator label with count", () => {
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun()}
        />,
      );
      expect(screen.getByText("8x H100")).toBeDefined();
    });

    it("renders total GPUs and node count", () => {
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun()}
        />,
      );
      expect(screen.getByText("32 GPUs (4 nodes)")).toBeDefined();
    });

    it("renders rank", () => {
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun()}
        />,
      );
      expect(screen.getByText("Rank 0 of 4")).toBeDefined();
    });

    it("renders node name", () => {
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun()}
        />,
      );
      expect(screen.getByText("gke-a100-pool-abc12")).toBeDefined();
    });

    it("renders namespace", () => {
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun()}
        />,
      );
      expect(screen.getByText("team-ml")).toBeDefined();
    });
  });

  describe("restart badge", () => {
    it("does not show restart badge when restart_attempt is 0", () => {
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun()}
        />,
      );
      expect(screen.queryByText(/Restart #/)).toBeNull();
    });

    it("shows restart badge when restart_attempt > 0", () => {
      const metadata = {
        konduktor: {
          ...fullKonduktorMetadata.konduktor,
          restart_attempt: "3",
        },
      };
      render(
        <KonduktorDisplay systemMetadata={metadata} run={makeRun()} />,
      );
      expect(screen.getByText("Restart #3")).toBeDefined();
    });
  });

  describe("GPU-hours computation", () => {
    it("computes GPU-hours for completed runs", () => {
      // 32 GPUs * 4 hours = 128.0 GPU-hrs
      render(
        <KonduktorDisplay
          systemMetadata={fullKonduktorMetadata}
          run={makeRun({
            createdAt: new Date("2024-01-01T00:00:00Z"),
            updatedAt: new Date("2024-01-01T04:00:00Z"),
            status: "COMPLETED",
          })}
        />,
      );
      expect(screen.getByText("128.0 GPU-hrs")).toBeDefined();
    });

    it("shows GPU-min for short runs", () => {
      // 32 GPUs * 0.5 hours = 16.0 GPU-hrs... but let's do < 1 hour total
      // 2 GPUs * 10 min = 0.33 GPU-hrs = 20.0 GPU-min
      const metadata = {
        konduktor: {
          ...fullKonduktorMetadata.konduktor,
          num_nodes: "1",
          num_gpus_per_node: "2",
          total_gpus: 2,
        },
      };
      render(
        <KonduktorDisplay
          systemMetadata={metadata}
          run={makeRun({
            createdAt: new Date("2024-01-01T00:00:00Z"),
            updatedAt: new Date("2024-01-01T00:10:00Z"),
            status: "COMPLETED",
          })}
        />,
      );
      expect(screen.getByText("20.0 GPU-min")).toBeDefined();
    });
  });

  describe("minimal metadata", () => {
    it("renders with only job_name (all other fields null)", () => {
      const metadata = {
        konduktor: {
          job_name: "minimal-job",
          num_nodes: null,
          num_gpus_per_node: null,
          total_gpus: null,
          rank: null,
          master_addr: null,
          accelerator_type: null,
          node_name: null,
          restart_attempt: null,
          namespace: null,
        },
      };
      render(
        <KonduktorDisplay systemMetadata={metadata} run={makeRun()} />,
      );
      expect(screen.getByText("Konduktor Job")).toBeDefined();
      expect(screen.getByText("minimal-job")).toBeDefined();
      // Optional fields should not render
      expect(screen.queryByText("Accelerator")).toBeNull();
      expect(screen.queryByText("GPU-Hours")).toBeNull();
    });
  });

  describe("Zod schema validation", () => {
    it("rejects metadata missing job_name", () => {
      const metadata = {
        konduktor: {
          num_nodes: "4",
        },
      };
      const { container } = render(
        <KonduktorDisplay systemMetadata={metadata} run={makeRun()} />,
      );
      expect(container.innerHTML).toBe("");
    });

    it("accepts metadata with extra unknown fields", () => {
      const metadata = {
        konduktor: {
          job_name: "extra-fields-test",
          unknown_field: "should be ignored",
        },
      };
      render(
        <KonduktorDisplay systemMetadata={metadata} run={makeRun()} />,
      );
      expect(screen.getByText("extra-fields-test")).toBeDefined();
    });
  });
});
