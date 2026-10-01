import { describe, expect, it } from "vitest";
import {
  AUTO_HIDE_TABLE_BELOW_PX,
  nextAutoCollapse,
  type AutoCollapseInput,
} from "@/lib/copilot-auto-collapse";

const narrow = AUTO_HIDE_TABLE_BELOW_PX - 1;
const wide = AUTO_HIDE_TABLE_BELOW_PX;

function input(overrides: Partial<AutoCollapseInput>): AutoCollapseInput {
  return {
    wasOpen: false,
    isOpen: false,
    isDocked: true,
    viewportWidth: narrow,
    listVisible: true,
    autoCollapsed: false,
    ...overrides,
  };
}

describe("nextAutoCollapse", () => {
  it("hides the runs table when the docked copilot opens on a narrow screen", () => {
    expect(nextAutoCollapse(input({ isOpen: true }))).toEqual({
      action: "collapse",
      autoCollapsed: true,
    });
  });

  it("restores the table when the copilot closes after hiding it", () => {
    expect(
      nextAutoCollapse(
        input({ wasOpen: true, listVisible: false, autoCollapsed: true }),
      ),
    ).toEqual({ action: "expand", autoCollapsed: false });
  });

  it("leaves a table the user hid themselves alone on close", () => {
    expect(
      nextAutoCollapse(
        input({ wasOpen: true, listVisible: false, autoCollapsed: false }),
      ),
    ).toEqual({ action: null, autoCollapsed: false });
  });

  it("does nothing on open when the table is already hidden", () => {
    expect(
      nextAutoCollapse(input({ isOpen: true, listVisible: false })),
    ).toEqual({ action: null, autoCollapsed: false });
  });

  it("does not hide the table on wide screens", () => {
    expect(
      nextAutoCollapse(input({ isOpen: true, viewportWidth: wide })),
    ).toEqual({ action: null, autoCollapsed: false });
  });

  it("does not hide the table when the copilot overlays instead of docking", () => {
    expect(
      nextAutoCollapse(input({ isOpen: true, isDocked: false })),
    ).toEqual({ action: null, autoCollapsed: false });
  });

  it("forgets the auto-hide once the user brings the table back while open", () => {
    expect(
      nextAutoCollapse(
        input({
          wasOpen: true,
          isOpen: true,
          listVisible: true,
          autoCollapsed: true,
        }),
      ),
    ).toEqual({ action: null, autoCollapsed: false });
  });

  it("is stable while the copilot stays open with the table hidden", () => {
    expect(
      nextAutoCollapse(
        input({
          wasOpen: true,
          isOpen: true,
          listVisible: false,
          autoCollapsed: true,
        }),
      ),
    ).toEqual({ action: null, autoCollapsed: true });
  });
});
