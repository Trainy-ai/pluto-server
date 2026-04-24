import { describe, it, expect } from "vitest";
import { metricSpecRequiresWipe } from "../metric-summaries-cache";

describe("metricSpecRequiresWipe", () => {
  it("no wipe when sets are identical", () => {
    expect(
      metricSpecRequiresWipe(
        new Set(["train/loss|MIN", "train/loss|MAX"]),
        new Set(["train/loss|MIN", "train/loss|MAX"]),
      ),
    ).toBe(false);
  });

  it("no wipe on pure removal — new is a strict subset of prev", () => {
    expect(
      metricSpecRequiresWipe(
        new Set(["train/loss|MIN", "train/loss|MAX", "val/acc|AVG"]),
        new Set(["train/loss|MIN"]),
      ),
    ).toBe(false);
  });

  it("no wipe when new is empty (all metrics removed)", () => {
    expect(
      metricSpecRequiresWipe(new Set(["train/loss|MIN"]), new Set()),
    ).toBe(false);
  });

  it("wipe when a new metric is added", () => {
    expect(
      metricSpecRequiresWipe(
        new Set(["train/loss|MIN"]),
        new Set(["train/loss|MIN", "val/acc|AVG"]),
      ),
    ).toBe(true);
  });

  it("wipe when initial set is empty and a metric is added", () => {
    expect(
      metricSpecRequiresWipe(new Set(), new Set(["train/loss|MIN"])),
    ).toBe(true);
  });

  it("wipe when one is removed AND one is added (any net-new triggers it)", () => {
    expect(
      metricSpecRequiresWipe(
        new Set(["train/loss|MIN"]),
        new Set(["val/acc|AVG"]),
      ),
    ).toBe(true);
  });

  it("treats different aggregations of the same metric as distinct", () => {
    // Same logName, different aggregation → different cache key, requires wipe.
    expect(
      metricSpecRequiresWipe(
        new Set(["train/loss|MIN"]),
        new Set(["train/loss|MIN", "train/loss|MAX"]),
      ),
    ).toBe(true);
  });
});
