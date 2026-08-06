import { describe, it, expect } from "vitest";
import {
  isFileLogWidgetVisible,
  isHiddenArtifactLog,
  isRenderableInWidget,
  isWandbArtifactLogName,
  keepVisibleFileLogs,
} from "../file-types";

/**
 * The two rules that decide whether a log gets a widget on a metrics view.
 *
 * Both metrics views import these — the all-runs Charts view
 * (`metrics-display.tsx`) and the individual-run All Metrics view
 * (`(run)/…/$runId/index.tsx`). They were separate implementations twice, and
 * both times the pages drifted: first the renderable-type rule was missing on
 * the run page (Plotly figures and point clouds invisible there), then the
 * artifact-NAME rule was missing on the run page (every wandb `.json` dump
 * rendered as a fetched, syntax-highlighted document).
 */

const log = (logName: string, logType = "ARTIFACT") => ({ logName, logType });

describe("isWandbArtifactLogName", () => {
  it("matches wandb's per-source-run artifact dumps", () => {
    expect(isWandbArtifactLogName("run-1yg0m03c-bar_table:v0")).toBe(true);
    expect(isWandbArtifactLogName("run-zvmxaggx-results:v0")).toBe(true);
    // Any version number, and names containing dashes/colons of their own.
    expect(isWandbArtifactLogName("run-abcd1234-my-table:v12")).toBe(true);
  });

  it("does not match names a user could plausibly have chosen", () => {
    // The rule hides a log with no way to reveal it, so its edges matter.
    expect(isWandbArtifactLogName("run-summary:v0")).toBe(false); // no run id
    expect(isWandbArtifactLogName("run-abcd123-x:v0")).toBe(false); // 7 chars
    expect(isWandbArtifactLogName("run-abcd12345-x:v0")).toBe(false); // 9 chars
    expect(isWandbArtifactLogName("run-ABCD1234-x:v0")).toBe(false); // upper case
    expect(isWandbArtifactLogName("run-abcd1234-x:v")).toBe(false); // no version
    expect(isWandbArtifactLogName("run-abcd1234-:v0")).toBe(false); // empty name
    expect(isWandbArtifactLogName("train/loss")).toBe(false);
    // Anchored at both ends — a longer name that merely contains one.
    expect(isWandbArtifactLogName("x/run-abcd1234-t:v0")).toBe(false);
    expect(isWandbArtifactLogName("run-abcd1234-t:v0/x")).toBe(false);
  });
});

describe("isHiddenArtifactLog", () => {
  it("hides a wandb dump logged as a file type", () => {
    expect(isHiddenArtifactLog("ARTIFACT", "run-abcd1234-dump:v0")).toBe(true);
    expect(isHiddenArtifactLog("FILE", "run-abcd1234-dump:v0")).toBe(true);
    expect(isHiddenArtifactLog("TEXT", "run-abcd1234-dump:v0")).toBe(true);
  });

  it("requires BOTH halves, so a metric is never swallowed by the name rule", () => {
    // The conjunction is the point: a user's own metric that happens to match
    // the artifact shape stays visible, because it is not a file log.
    expect(isHiddenArtifactLog("METRIC", "run-abcd1234-dump:v0")).toBe(false);
    // ...and an ordinary file log is not hidden just for being a file log.
    expect(isHiddenArtifactLog("ARTIFACT", "plotly")).toBe(false);
  });
});

describe("keepVisibleFileLogs", () => {
  // A run's derived `files` group after a wandb migration: real figures beside
  // the exporter's own dumps.
  const renderable = new Set(["plotly", "html", "run-abcd1234-dump:v0"]);

  it("hides wandb artifact dumps even when their file type IS renderable", () => {
    // The regression: a dump is stored as a raw `.json`, which
    // `isRenderableInWidget` accepts (it cannot tell a Plotly figure from a
    // blob without the body), so the type rule alone leaves it on the page.
    expect(isRenderableInWidget("json")).toBe(true);

    const kept = keepVisibleFileLogs(
      [log("plotly"), log("run-abcd1234-dump:v0")],
      renderable,
    );
    expect(kept.map((l) => l.logName)).toEqual(["plotly"]);
  });

  it("hides a dump in a MIXED group too, where the type rule never runs", () => {
    const kept = keepVisibleFileLogs(
      [log("train/loss", "METRIC"), log("run-abcd1234-dump:v0")],
      renderable,
    );
    expect(kept.map((l) => l.logName)).toEqual(["train/loss"]);
  });

  it("empties a group whose only file logs are dumps", () => {
    expect(
      keepVisibleFileLogs([log("run-abcd1234-dump:v0")], renderable),
    ).toEqual([]);
  });

  it("keeps file logs a widget can draw", () => {
    const kept = keepVisibleFileLogs([log("plotly"), log("html")], renderable);
    expect(kept.map((l) => l.logName)).toEqual(["plotly", "html"]);
  });

  it("drops non-renderable file logs from a file-ONLY group", () => {
    const kept = keepVisibleFileLogs(
      [log("plotly"), log("checkpoint"), log("dataset")],
      renderable,
    );
    expect(kept.map((l) => l.logName)).toEqual(["plotly"]);
  });

  it("leaves a mixed group's non-renderable file log alone", () => {
    // Deliberately looser than the all-runs view, which prunes non-renderable
    // file logs from every group. A mixed group is one the user built, and
    // reading `train/samples.txt` on the run's own page is the point of it —
    // it has rendered there since long before any of the renderable rules.
    const kept = keepVisibleFileLogs(
      [log("train/loss", "METRIC"), log("train/samples", "TEXT")],
      renderable,
    );
    expect(kept.map((l) => l.logName)).toEqual(["train/loss", "train/samples"]);
  });

  it("classifies nothing while the file-type probe is still in flight", () => {
    // An empty set is the loading state: file-only groups stay hidden, which is
    // how the page behaved before file widgets existed. Nothing flashes in and
    // then back out.
    expect(keepVisibleFileLogs([log("plotly"), log("html")], new Set())).toEqual(
      [],
    );
  });

  it("never touches a group with no file logs at all", () => {
    const metrics = [log("train/loss", "METRIC"), log("val/acc", "METRIC")];
    expect(keepVisibleFileLogs(metrics, new Set())).toEqual(metrics);
  });
});

describe("isFileLogWidgetVisible", () => {
  // The all-runs view probes only a SAMPLE of the selected runs, so this rule
  // has to distinguish "we looked and it can't be drawn" from "we never looked".
  const renderable = new Set(["plotly", "figure.html"]);
  const probed = new Set(["plotly", "figure.html", "dataset.parquet"]);

  it("always keeps a non-file log, whatever the probes saw", () => {
    expect(isFileLogWidgetVisible("METRIC", "train/loss", new Set(), new Set())).toBe(true);
    // Even if a metric somehow shares a name with an unrenderable file log.
    expect(isFileLogWidgetVisible("METRIC", "dataset.parquet", renderable, probed)).toBe(true);
  });

  it("keeps a file log a probe confirmed is renderable", () => {
    expect(isFileLogWidgetVisible("ARTIFACT", "plotly", renderable, probed)).toBe(true);
    expect(isFileLogWidgetVisible("TEXT", "figure.html", renderable, probed)).toBe(true);
  });

  it("hides a file log a probe confirmed is NOT renderable", () => {
    // The case the filter exists for: a wandb .table.json blob.
    expect(isFileLogWidgetVisible("ARTIFACT", "dataset.parquet", renderable, probed)).toBe(false);
  });

  it("keeps a file log no probe ever saw", () => {
    // The regression this rule was rewritten for. A Plotly figure logged only
    // by run #4 is absent from a 3-run sample; treating unseen as undrawable
    // hid it from the all-runs view entirely, with no affordance to reveal it.
    expect(isFileLogWidgetVisible("ARTIFACT", "run-4-only-figure", renderable, probed)).toBe(true);
  });

  it("keeps everything while the probes are still in flight", () => {
    // No probe has landed, so nothing is known and nothing is hidden.
    expect(isFileLogWidgetVisible("ARTIFACT", "plotly", new Set(), new Set())).toBe(true);
    expect(isFileLogWidgetVisible("FILE", "dataset.parquet", new Set(), new Set())).toBe(true);
  });

  it("hides a probed blob even when other probes returned nothing useful", () => {
    // One run carries the log and it is unrenderable; the rest simply lack it.
    // Presence in `probed` is what counts, not how many runs agreed.
    expect(isFileLogWidgetVisible("ARTIFACT", "dataset.parquet", new Set(), probed)).toBe(false);
  });
});
