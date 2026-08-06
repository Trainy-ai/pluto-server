import { describe, it, expect } from "vitest";
import { detectMediaJson } from "../media-json";

/**
 * Content sniffing for UUID-named `.json` media. Filename cannot distinguish
 * Plotly / point cloud / blob — only the parsed shape can.
 */
describe("detectMediaJson", () => {
  it("recognises a Plotly figure by trace objects under data", () => {
    expect(
      detectMediaJson({
        data: [{ type: "scatter", x: [1], y: [2] }],
        layout: { title: "t" },
      }),
    ).toBe("plotly");
  });

  it("rejects a data array of non-trace values", () => {
    expect(detectMediaJson({ columns: ["a"], data: [[1, 2]] })).toBeNull();
  });

  it("recognises wandb Object3D widths 3, 4 and 6", () => {
    expect(detectMediaJson([[0, 1, 2], [1, 2, 3]])).toBe("point-cloud");
    expect(detectMediaJson([[0, 1, 2, 3], [1, 2, 3, 4]])).toBe("point-cloud");
    expect(
      detectMediaJson([
        [0, 0, 0, 255, 0, 0],
        [1, 0, 0, 0, 255, 0],
      ]),
    ).toBe("point-cloud");
  });

  it("rejects width-5 numeric rows (not a wandb Object3D shape)", () => {
    expect(
      detectMediaJson([
        [0, 1, 2, 3, 4],
        [1, 2, 3, 4, 5],
      ]),
    ).toBeNull();
  });

  it("rejects jagged or non-numeric rows that only look like a cloud at [0]", () => {
    expect(
      detectMediaJson([
        [0, 1, 2],
        [1, 2],
      ]),
    ).toBeNull();
    expect(
      detectMediaJson([
        [0, 1, 2],
        ["a", "b", "c"],
      ]),
    ).toBeNull();
  });
});
