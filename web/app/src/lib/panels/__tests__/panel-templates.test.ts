import { describe, expect, it } from "vitest";
import { PANEL_TEMPLATES } from "../panel-templates";
import { validateRequirements } from "../panel-requirements";

/** Mirror of PanelWidgetConfigSchema's code cap (dashboard-types.ts). */
const MAX_CODE_LENGTH = 65_536;

/** Async data methods exposed by src/lib/panels/mlop_sdk.py. */
const SDK_ASYNC_METHODS = new Set([
  "get_runs",
  "get_metric_names",
  "get_file_log_names",
  "get_metrics",
  "get_metric_summaries",
  "get_metric_values",
  "get_logs",
  "get_file_url",
]);
/** Sync helpers exposed by the SDK. */
const SDK_SYNC_METHODS = new Set(["get_context", "colors"]);

/**
 * Packages importable offline: the vendored Pyodide distribution's
 * relevant libs + the pure wheels injected into the vendored
 * pyodide-lock.json (see scripts/fetch-panel-assets.mjs), + stdlib
 * modules templates use.
 */
const OFFLINE_IMPORTABLE = new Set([
  "streamlit",
  "mlop",
  "pandas",
  "numpy",
  "matplotlib",
  "matplotlib.pyplot",
  "seaborn",
  "plotly",
  "math",
  "json",
  "asyncio",
]);

describe("PANEL_TEMPLATES", () => {
  it("has a curated non-trivial set with unique ids and names", () => {
    expect(PANEL_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    expect(PANEL_TEMPLATES.length).toBeLessThanOrEqual(8);
    expect(new Set(PANEL_TEMPLATES.map((t) => t.id)).size).toBe(
      PANEL_TEMPLATES.length,
    );
    expect(new Set(PANEL_TEMPLATES.map((t) => t.name)).size).toBe(
      PANEL_TEMPLATES.length,
    );
  });

  it.each(PANEL_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s passes the widget-config constraints",
    (_id, template) => {
      expect(template.name.trim().length).toBeGreaterThan(0);
      expect(template.description.trim().length).toBeGreaterThan(0);
      expect(template.code.trim().length).toBeGreaterThan(0);
      expect(template.code.length).toBeLessThanOrEqual(MAX_CODE_LENGTH);
      // Same validation the editor applies before Run/Save.
      expect(validateRequirements(template.requirements)).toBeNull();
    },
  );

  it.each(PANEL_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s only calls the documented mlop SDK surface",
    (_id, template) => {
      const calls = [...template.code.matchAll(/\bmlop\.(\w+)\(/g)].map(
        (match) => match[1],
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(
          SDK_ASYNC_METHODS.has(call) || SDK_SYNC_METHODS.has(call),
          `mlop.${call} is not part of the SDK`,
        ).toBe(true);
      }
      // Async SDK calls must be awaited (worker cannot sync-block).
      for (const method of SDK_ASYNC_METHODS) {
        const bare = new RegExp(`(?<!await )\\bmlop\\.${method}\\(`);
        expect(
          bare.test(template.code),
          `mlop.${method} must be awaited`,
        ).toBe(false);
      }
    },
  );

  it.each(PANEL_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s only imports offline-available packages",
    (_id, template) => {
      const imports = [
        ...template.code.matchAll(
          /^(?:import|from)\s+([A-Za-z_][\w.]*)/gm,
        ),
      ].map((match) => match[1]);
      expect(imports).toContain("streamlit");
      for (const name of imports) {
        expect(
          OFFLINE_IMPORTABLE.has(name),
          `import ${name} is not offline-available in the sandbox`,
        ).toBe(true);
      }
      // seaborn additionally needs an explicit requirement (pure wheel,
      // resolved by micropip from the vendored lockfile).
      if (imports.includes("seaborn")) {
        expect(template.requirements).toContain("seaborn");
      }
      // matplotlib is vendored but NOT in Streamlit's dependency set, so
      // it only loads when requested — directly or via seaborn.
      if (imports.some((name) => name.startsWith("matplotlib"))) {
        expect(
          template.requirements.includes("matplotlib") ||
            template.requirements.includes("seaborn"),
          "matplotlib imports need a matplotlib (or seaborn) requirement",
        ).toBe(true);
      }
    },
  );

  it("keeps the first template in sync with the starter config", async () => {
    const { createStarterPanelConfig } = await import(
      "../../../routes/o.$orgSlug._authed/(runComparison)/projects.$projectName/~components/dashboard-builder/panel-starter-template"
    );
    expect(PANEL_TEMPLATES[0].code).toBe(createStarterPanelConfig().code);
    expect(PANEL_TEMPLATES[0].requirements).toEqual([]);
  });
});
