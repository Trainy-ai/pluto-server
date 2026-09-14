import { describe, expect, it } from "vitest";
import { parseRunCitations } from "../chat-citations";

describe("parseRunCitations", () => {
  it("separates valid run citations from surrounding text", () => {
    expect(
      parseRunCitations("Loss improved [run:Ab12z] after tuning."),
    ).toEqual([
      { type: "text", value: "Loss improved " },
      { type: "citation", runId: "Ab12z" },
      { type: "text", value: " after tuning." },
    ]);
  });

  it("leaves malformed citation-like text inert", () => {
    expect(parseRunCitations("See [run:../admin].")).toEqual([
      { type: "text", value: "See [run:../admin]." },
    ]);
  });
});
