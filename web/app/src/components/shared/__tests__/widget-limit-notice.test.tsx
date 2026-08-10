import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WidgetLimitNotice } from "../widget-limit-notice";

/**
 * The vocabulary is load-bearing: line charts draw one series per (metric,
 * run), media/histogram/bars widgets draw one strip per run. Reporting the
 * wrong noun tells the user to change the wrong thing.
 */
describe("WidgetLimitNotice", () => {
  afterEach(cleanup);

  it("reports runs for widgets with no metric axis", () => {
    render(
      <WidgetLimitNotice title="images/training_viz" unit="runs" count={250} max={200} />,
    );
    expect(screen.getByText("images/training_viz")).toBeDefined();
    expect(screen.getByText("Too many runs (250). Maximum is 200.")).toBeDefined();
    expect(
      screen.getByText("Reduce your selection to 200 runs or fewer."),
    ).toBeDefined();
  });

  it("reports series for line charts", () => {
    render(<WidgetLimitNotice title="loss" unit="series" count={250} max={200} />);
    expect(screen.getByText("Too many series (250). Maximum is 200.")).toBeDefined();
  });

  it("takes a custom hint when runs are not the binding limit", () => {
    render(
      <WidgetLimitNotice
        title="loss"
        unit="series"
        count={600}
        max={500}
        hint="Reduce the number of selected runs or metrics."
      />,
    );
    expect(screen.getByText("Too many series (600). Maximum is 500.")).toBeDefined();
    expect(
      screen.getByText("Reduce the number of selected runs or metrics."),
    ).toBeDefined();
  });

  it("renders without a title", () => {
    const { container } = render(
      <WidgetLimitNotice unit="runs" count={201} max={200} />,
    );
    expect(screen.getByText("Too many runs (201). Maximum is 200.")).toBeDefined();
    expect(container.querySelectorAll("p").length).toBe(2);
  });
});
