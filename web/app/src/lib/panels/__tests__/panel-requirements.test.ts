import { describe, expect, it } from "vitest";
import {
  MAX_REQUIREMENTS,
  MAX_REQUIREMENT_LENGTH,
  formatRequirements,
  parseRequirements,
  requirementsEqual,
  validateRequirements,
} from "../panel-requirements";

describe("parseRequirements", () => {
  it("splits on commas and trims whitespace", () => {
    expect(parseRequirements("seaborn, plotly ,  pandas")).toEqual([
      "seaborn",
      "plotly",
      "pandas",
    ]);
  });

  it("splits on newlines and mixed separators", () => {
    expect(parseRequirements("seaborn\nplotly,\npandas")).toEqual([
      "seaborn",
      "plotly",
      "pandas",
    ]);
  });

  it("drops empty entries", () => {
    expect(parseRequirements(",, seaborn ,\n\n,")).toEqual(["seaborn"]);
    expect(parseRequirements("")).toEqual([]);
    expect(parseRequirements("   \n  ")).toEqual([]);
  });

  it("dedupes case-insensitively keeping first-seen spelling", () => {
    expect(parseRequirements("Seaborn, seaborn, SEABORN, plotly")).toEqual([
      "Seaborn",
      "plotly",
    ]);
  });

  it("keeps version specifiers intact", () => {
    expect(parseRequirements("plotly==5.22.0, pandas>=2")).toEqual([
      "plotly==5.22.0",
      "pandas>=2",
    ]);
  });
});

describe("validateRequirements", () => {
  it("accepts an empty list", () => {
    expect(validateRequirements([])).toBeNull();
  });

  it("accepts plain names, extras and version specs", () => {
    expect(
      validateRequirements([
        "seaborn",
        "plotly==5.22.0",
        "pandas>=2,<3",
        "scikit-learn",
        "foo[bar]~=1.0",
        "typing_extensions",
      ]),
    ).toBeNull();
  });

  it("rejects more than the server cap of entries", () => {
    const requirements = Array.from(
      { length: MAX_REQUIREMENTS + 1 },
      (_, index) => `pkg${index}`,
    );
    expect(validateRequirements(requirements)).toMatch(/Too many packages/);
  });

  it("accepts exactly the server cap of entries", () => {
    const requirements = Array.from(
      { length: MAX_REQUIREMENTS },
      (_, index) => `pkg${index}`,
    );
    expect(validateRequirements(requirements)).toBeNull();
  });

  it("rejects entries longer than the per-entry cap", () => {
    const requirement = "a".repeat(MAX_REQUIREMENT_LENGTH + 1);
    expect(validateRequirements([requirement])).toMatch(/too long/);
  });

  it("accepts entries at exactly the per-entry cap", () => {
    const requirement = "a".repeat(MAX_REQUIREMENT_LENGTH);
    expect(validateRequirements([requirement])).toBeNull();
  });

  it("rejects garbage that is clearly not a package spec", () => {
    for (const bad of [
      "not a package",
      "rm -rf /",
      "pkg; echo hi",
      "-leading-dash",
      "trailing-dash-",
    ]) {
      expect(validateRequirements([bad]), bad).toMatch(/not a valid package/);
    }
  });

  it("reports the first invalid entry", () => {
    expect(validateRequirements(["seaborn", "b a d", "plotly"])).toMatch(
      /"b a d"/,
    );
  });
});

describe("formatRequirements", () => {
  it("round-trips through parseRequirements", () => {
    const requirements = ["seaborn", "plotly==5.22.0"];
    expect(parseRequirements(formatRequirements(requirements))).toEqual(
      requirements,
    );
  });

  it("formats an empty list as an empty string", () => {
    expect(formatRequirements([])).toBe("");
  });
});

describe("requirementsEqual", () => {
  it("compares order-sensitively", () => {
    expect(requirementsEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(requirementsEqual(["a", "b"], ["b", "a"])).toBe(false);
    expect(requirementsEqual(["a"], ["a", "b"])).toBe(false);
    expect(requirementsEqual([], [])).toBe(true);
  });
});
