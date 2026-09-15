import { describe, expect, it } from "vitest";
import {
  grantedTools,
  PLUTO_MCP_SERVER,
  READ_TOOLS,
  withheldTools,
  WRITE_TOOLS,
} from "../tool-policy.js";

const EXPECTED_WRITES = [
  "add_tags",
  "remove_tags",
  "update_notes",
  "create_dashboard",
  "update_dashboard",
  "restore_dashboard_version",
];

describe("tool policy", () => {
  it("grants every read tool and no write tool by default", () => {
    expect(grantedTools(false)).toEqual([...READ_TOOLS]);
    for (const tool of EXPECTED_WRITES) {
      expect(grantedTools(false)).not.toContain(tool);
    }
    expect(grantedTools(false)).toContain("read_dashboard");
    expect(grantedTools(false)).toContain("render_panels");
  });

  it("withholds exactly the six write tools by default", () => {
    expect([...withheldTools(false)].sort()).toEqual(
      [...EXPECTED_WRITES].sort(),
    );
  });

  it("adds exactly the six write tools with allowWrites", () => {
    expect(grantedTools(true)).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
    expect([...WRITE_TOOLS].sort()).toEqual([...EXPECTED_WRITES].sort());
    expect(withheldTools(true)).toEqual([]);
  });

  it("never lists a tool as both read and write", () => {
    const overlap = READ_TOOLS.filter((tool) => WRITE_TOOLS.includes(tool));
    expect(overlap).toEqual([]);
  });

  it("scopes tools to the pluto server", () => {
    expect(PLUTO_MCP_SERVER).toBe("pluto");
  });
});
