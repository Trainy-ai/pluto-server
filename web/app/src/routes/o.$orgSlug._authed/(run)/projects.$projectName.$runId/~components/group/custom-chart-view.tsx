import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MediaCardWrapper } from "@/components/core/media-card-wrapper";
import { WANDB_PRESET_SPECS } from "@/lib/wandb-vega-presets";
import { useTheme } from "@/lib/hooks/use-theme";
import { vegaConfig } from "@/lib/vega-theme";

/**
 * A migrated wandb custom chart (`wandb.plot.*`), rendered from wandb's own
 * Vega spec.
 *
 * The exporter recovers each panel from wandb's raw `config.yaml`
 * (`_wandb.value.visualize`) and forwards it as `config.wandb.custom_charts`:
 *
 *   { key, title, preset, panelDefId, tableKey, fields, specLang }
 *
 * That is a spec *reference* plus a field→column mapping — the spec body lives
 * on wandb's servers and is never exported. `wandb-vega-presets.ts` holds those
 * spec bodies, so rendering is: look the spec up by `panelDefId`, substitute the
 * `${field:…}`/`${string:…}` placeholders from `fields`/`title`, and feed it the
 * backing table's rows under the dataset name wandb uses, `wandb`.
 *
 * Using wandb's actual specs rather than lookalike templates is what makes these
 * match the source workspace. Hand-written templates got the bar chart's
 * orientation, the histogram's bin widths, the scatter's gradient colouring and
 * the confusion matrix's normalise toggle all wrong, and each was invisible
 * until compared side by side.
 *
 * Dispatch is on `panelDefId`, not `preset`: `wandb.plot.pr_curve`,
 * `roc_curve` and `confusion_matrix` all arrive with `preset: null`, so keying
 * off `preset` silently dropped them as "hand-authored Vega".
 *
 * vega-embed is imported dynamically, so the Vega runtime lands in its own chunk
 * and never enters the main bundle.
 */

export interface CustomChartPanel {
  key: string;
  title?: string | null;
  preset: string | null;
  panelDefId?: string | null;
  tableKey: string;
  fields?: Record<string, string> | null;
  /**
   * wandb's `stringSettings` verbatim — `title` plus the axis titles the curve
   * preset needs (`x-axis-title`, `y-axis-title`). Absent on runs migrated
   * before the exporter forwarded it; see `resolveString`.
   */
  strings?: Record<string, string> | null;
  specLang?: string | null;
}

interface CustomChartViewProps {
  panel: CustomChartPanel;
  tenantId: string;
  projectName: string;
  runId: string;
  /** Series label. wandb's specs put it in the legend; the sqid reads as noise. */
  runName?: string;
  className?: string;
}

interface TableShape {
  table: unknown[][];
  col?: { name: string }[];
}

/** One run's backing table for a panel. */
export interface ChartSource {
  runName: string;
  /** The run's colour from the runs table — wandb's specs colour by it. */
  color: string;
  table: TableShape;
}

/** Fallback series colour where the caller has no run colour (the run page). */
export const DEFAULT_SERIES_COLOR = "#60a5fa";

/**
 * Older payloads (and anything the exporter recognised as a named preset) carry
 * `preset` but may predate `panelDefId`. Map the names onto the same ids so both
 * shapes render.
 */
const PRESET_NAME_TO_ID: Record<string, string> = {
  bar: "wandb/bar/v0",
  histogram: "wandb/histogram/v0",
  line: "wandb/line/v0",
  scatter: "wandb/scatter/v0",
  pr_curve: "wandb/area-under-curve/v0",
  roc_curve: "wandb/area-under-curve/v0",
  confusion_matrix: "wandb/confusion_matrix/v1",
  lineseries: "wandb/lineseries/v0",
};

/** The preset id to render this panel with, or null if we have no spec for it. */
function presetIdFor(panel: CustomChartPanel): string | null {
  const direct = panel.panelDefId;
  if (direct && WANDB_PRESET_SPECS[direct]) return direct;
  const mapped = panel.preset ? PRESET_NAME_TO_ID[panel.preset] : undefined;
  return mapped && WANDB_PRESET_SPECS[mapped] ? mapped : null;
}

/**
 * Rows in the shape wandb's specs expect: the table's columns, plus `name` and
 * `color` per row. The specs group and colour by those two
 * (`"scale": {"range": {"field": "color"}}`), which is how one chart shows
 * several runs.
 */
function toRecords(sources: ChartSource[]): Record<string, unknown>[] {
  return sources.flatMap((src) => {
    const cols = (src.table.col ?? []).map((c) => c.name);
    return src.table.table.map((row) => {
      const rec: Record<string, unknown> = {
        name: src.runName,
        color: src.color || DEFAULT_SERIES_COLOR,
      };
      row.forEach((cell, i) => {
        rec[cols[i] ?? `col${i}`] = cell;
      });
      return rec;
    });
  });
}

/**
 * Substitute wandb's spec placeholders.
 *
 * Done on the serialised spec because the placeholders appear both as whole
 * values (`"field": "${field:x}"`) and embedded in expression strings
 * (`"datum.${field:Actual}"`), which a structural walk would have to special-case.
 * An unmapped field becomes "" — that is what wandb does, and the specs' own
 * `if('${field:groupKeys}' === '', …)` guards are written to expect it.
 */
function substitutePlaceholders(
  spec: Record<string, unknown>,
  fields: Record<string, string>,
  strings: Record<string, string>,
): Record<string, unknown> {
  // `[\w-]` not `\w`: the curve preset's placeholders are `${string:x-axis-title}`
  // and `${string:y-axis-title}`, which a `\w`-only pattern skipped — the literal
  // text rendered as the axis label.
  const filled = JSON.stringify(spec)
    .replace(/\$\{field:([\w-]+)\}/g, (_m, key: string) => escapeForJson(fields[key] ?? ""))
    .replace(/\$\{string:([\w-]+)\}/g, (_m, key: string) =>
      escapeForJson(resolveString(key, strings, fields)),
    );
  return JSON.parse(filled) as Record<string, unknown>;
}

/**
 * The exporter now forwards `stringSettings` whole, so axis titles normally
 * arrive ("Recall", "False positive rate"). Runs migrated before that change
 * have no `strings` at all, and the column name ("recall") reads better on
 * their axes than the blank an unresolved placeholder would leave. Drop this
 * once no pre-`strings` migrations are left anywhere that matters.
 */
function resolveString(
  key: string,
  strings: Record<string, string>,
  fields: Record<string, string>,
): string {
  const given = strings[key];
  if (given) return given;
  const axis = /^([xy])-axis-title$/.exec(key);
  return axis ? (fields[axis[1]] ?? "") : "";
}

/** Substituting into an already-serialised spec means re-escaping the value. */
function escapeForJson(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Drop encodings left pointing at nothing.
 *
 * A preset declares every channel it could use, but a panel only maps the
 * fields it actually logged — `wandb.plot.line` never sets `stroke`, so
 * `line/v0`'s `"strokeDash": {"field": "${field:stroke}"}` substitutes to
 * `{"field": ""}` and Vega rejects the whole spec with "Invalid field
 * reference". wandb's own renderer prunes these; without it the line preset
 * fails outright.
 */
function pruneEmptyFieldRefs(node: unknown): void {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      if (isEmptyFieldRef(node[i])) {
        node.splice(i, 1);
      } else {
        pruneEmptyFieldRefs(node[i]);
      }
    }
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (isEmptyFieldRef(obj[key])) {
      delete obj[key];
    } else {
      pruneEmptyFieldRefs(obj[key]);
    }
  }
}

/**
 * Only `{field: ""}` counts. A bare `""` does not: the confusion-matrix preset
 * declares signals with `"value": ""` as their genuine default (the empty
 * class filter), and deleting those left the signal undefined and its
 * `split(classesToFilter, ',')` filter throwing.
 */
function isEmptyFieldRef(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).field === ""
  );
}

/**
 * Attach the rows to the spec's `wandb` dataset.
 *
 * Vega-Lite takes named data via top-level `datasets`; raw Vega (the confusion
 * matrix) declares `data` as an array of named sources, and the named one there
 * carries its own transforms, so the values go onto that entry in place.
 */
function attachData(
  spec: Record<string, unknown>,
  records: Record<string, unknown>[],
): void {
  if (Array.isArray(spec.data)) {
    for (const source of spec.data as Record<string, unknown>[]) {
      if (source?.name === "wandb") source.values = records;
    }
    return;
  }
  spec.datasets = { ...(spec.datasets as object), wandb: records };
}

/**
 * Spec controls we deliberately don't surface.
 *
 * wandb's confusion matrix pairs a `classesToFilter` text box with a
 * `filterClasses` checkbox — two controls for one action, where either alone
 * does nothing, and the box carries no label beyond a truncated placeholder.
 * Not worth the space in a Pluto widget; the runs table already filters.
 *
 * Their bindings are still stripped (so Vega renders no raw HTML controls) and
 * their spec defaults still apply — `filterClasses: false` means no filtering.
 */
const HIDDEN_CONTROLS = new Set(["filterClasses", "classesToFilter"]);

/** A spec signal wandb exposes as a panel setting (e.g. normalise). */
export interface ChartControl {
  name: string;
  label: string;
  kind: "checkbox" | "text";
  initial: boolean | string;
  placeholder?: string;
}

/**
 * Take the bound signals off the spec and describe them for the caller.
 *
 * Left bound, Vega renders its own raw HTML form controls under the chart,
 * which looks broken inside a Pluto widget. Stripping the binding alone lost
 * the feature — the confusion matrix's "Normalized" toggle and class filter
 * became unreachable — so the caller re-renders them as Pluto controls and
 * writes back to the signal.
 */
function extractControls(spec: Record<string, unknown>): ChartControl[] {
  if (!Array.isArray(spec.signals)) return [];
  const controls: ChartControl[] = [];
  for (const signal of spec.signals as Record<string, unknown>[]) {
    const bind = signal.bind as { input?: string; placeholder?: string } | undefined;
    delete signal.bind;
    if (!bind?.input || typeof signal.name !== "string") continue;
    // Hidden rather than filtered by input type, so a control wandb adds in a
    // future spec still surfaces by default. Silently dropping unrecognised
    // binds is what made the confusion matrix lose these in the first place.
    if (HIDDEN_CONTROLS.has(signal.name)) continue;
    if (bind.input === "checkbox") {
      controls.push({
        name: signal.name,
        label: humanizeSignal(signal.name),
        kind: "checkbox",
        initial: signal.value === true,
      });
    } else if (bind.input === "input") {
      controls.push({
        name: signal.name,
        label: humanizeSignal(signal.name),
        kind: "text",
        initial: typeof signal.value === "string" ? signal.value : "",
        placeholder: bind.placeholder,
      });
    }
  }
  return controls;
}

/** `classesToFilter` → "Classes to filter". Signal names are wandb's, not ours. */
function humanizeSignal(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Build the renderable spec for a panel, or null when we have no spec for it
 * (a hand-authored Vega panel, whose body wandb never exports).
 */
export function buildVegaSpec(
  panel: CustomChartPanel,
  sources: ChartSource[],
): { spec: Record<string, unknown>; controls: ChartControl[] } | null {
  if (sources.length === 0) return null;
  const presetId = presetIdFor(panel);
  if (!presetId) return null;

  const spec = substitutePlaceholders(WANDB_PRESET_SPECS[presetId], panel.fields ?? {}, {
    ...(panel.strings ?? {}),
    // `title` predates `strings` and is the one key guaranteed present, so it
    // stays authoritative — and gives a label for a panel that had none.
    title: panel.title || panel.strings?.title || panel.key,
  });

  // Prune before attaching data: the rows are user values and must not be
  // walked (a legitimately empty cell would be treated as a dead reference).
  pruneEmptyFieldRefs(spec);
  attachData(spec, toRecords(sources));
  const controls = extractControls(spec);

  // wandb's Vega-Lite presets carry no size; without this vega-embed picks a
  // fixed default width and the chart ignores the widget. The raw-Vega preset
  // already sizes itself off `containerSize()`.
  if (!Array.isArray(spec.data)) {
    spec.width = "container";
    spec.height = "container";
    spec.autosize = { type: "fit", contains: "padding" };
  }

  return { spec, controls };
}

/**
 * Its own component so each mount owns its container ref.
 *
 * MediaCardWrapper renders children twice — inline and inside the fullscreen
 * dialog. Sharing one ref between them meant React bound it to whichever
 * mounted last and the other never rendered.
 */
export function VegaChart({
  spec,
  controls = [],
  title,
}: {
  spec: Record<string, unknown>;
  controls?: ChartControl[];
  title: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<VegaView | null>(null);
  // Serialize embeds so a superseded in-flight `vega-embed` cannot write into
  // the shared host after a newer effect has already adopted a view (and then
  // finalize itself, blanking the chart).
  const embedChainRef = useRef(Promise.resolve());
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  const [values, setValues] = useState<Record<string, boolean | string>>(() =>
    Object.fromEntries(controls.map((c) => [c.name, c.initial])),
  );
  // A ref as well as state: the embed effect must not re-run when a control
  // changes (that would rebuild the whole view on every keystroke), but it does
  // need the current values to restore them after a rebuild.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    let disposed = false;
    let view: VegaView | null = null;

    const run = async () => {
      const prev = embedChainRef.current;
      let release!: () => void;
      embedChainRef.current = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prev;

      if (disposed || !hostRef.current) {
        release();
        return;
      }

      try {
        // Clear any prior failure so a theme/data rebuild can recover — the
        // host must stay mounted (see render below) or `hostRef` goes null and
        // every subsequent attempt bails before clearing `error`.
        setError(null);
        const { default: embed } = await import("vega-embed");
        if (disposed || !hostRef.current) {
          return;
        }
        const result = await embed(hostRef.current, spec as never, {
          actions: false,
          renderer: "canvas",
          config: vegaConfig(resolvedTheme) as never,
        });
        if (disposed) {
          result.view.finalize();
          return;
        }
        view = result.view as unknown as VegaView;
        viewRef.current = view;
        // Re-apply after a rebuild (theme switch, new data) so the user's
        // toggles survive instead of snapping back to the spec's defaults.
        applySignals(view, valuesRef.current);
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        release();
      }
    };

    void run();

    return () => {
      disposed = true;
      viewRef.current = null;
      view?.finalize();
    };
    // Theme is a dep: config is baked in at embed time, so a light/dark switch
    // has to rebuild the view or the chrome keeps the old theme's colours.
  }, [spec, resolvedTheme]);

  const setSignal = (name: string, value: boolean | string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    const view = viewRef.current;
    if (view) {
      view.signal(name, value).run();
    }
  };

  // Keep the host mounted even when showing an error — unmounting it (early
  // return) makes `hostRef.current` null, so the next effect cannot re-embed.
  return (
    <>
      {error ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-destructive">
          Could not render chart: {error}
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={cn(
          "min-h-0 w-full flex-1 [&_canvas]:!max-w-full",
          error && "hidden",
        )}
        aria-label={`${title} chart`}
      />
      {controls.length > 0 && (
        <ChartControls controls={controls} values={values} onChange={setSignal} />
      )}
    </>
  );
}

/** The slice of Vega's View we use. Avoids importing the type from the lazy chunk. */
interface VegaView {
  signal: (name: string, value: unknown) => VegaView;
  run: () => void;
  finalize: () => void;
}

function applySignals(view: VegaView, values: Record<string, boolean | string>): void {
  const names = Object.keys(values);
  if (names.length === 0) return;
  for (const name of names) {
    view.signal(name, values[name]);
  }
  view.run();
}

/**
 * wandb's panel settings, as Pluto controls.
 *
 * These are the spec's own bound signals — for the confusion matrix,
 * "Normalized" and the class filter. Vega would render them as unstyled HTML
 * form controls, so the bindings are stripped in `extractControls` and replayed
 * here through `view.signal()`.
 */
function ChartControls({
  controls,
  values,
  onChange,
}: {
  controls: ChartControl[];
  values: Record<string, boolean | string>;
  onChange: (name: string, value: boolean | string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-1">
      {controls.map((control) =>
        control.kind === "checkbox" ? (
          <label
            key={control.name}
            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <Checkbox
              checked={values[control.name] === true}
              onCheckedChange={(checked) => onChange(control.name, checked === true)}
              className="size-3.5"
            />
            {control.label}
          </label>
        ) : (
          <Input
            key={control.name}
            value={String(values[control.name] ?? "")}
            placeholder={control.placeholder ?? control.label}
            onChange={(e) => onChange(control.name, e.target.value)}
            className="h-6 w-44 text-[11px]"
          />
        ),
      )}
    </div>
  );
}

/**
 * A table log holds one table per step. A custom chart is a summary artefact —
 * wandb logs it once, or overwrites it — so the newest step is the one to draw.
 */
export function latestTable(data: { step: number; tableData?: unknown }[] | undefined) {
  if (!data || data.length === 0) return null;
  const newest = [...data].sort((a, b) => b.step - a.step)[0]?.tableData;
  const table = (newest ?? null) as TableShape | null;
  return table?.table?.length ? table : null;
}

/** Shown when a panel has data but no spec we can render it with. */
export function CustomChartFallback({ panel }: { panel: CustomChartPanel }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
      <p className="text-xs text-muted-foreground">
        Hand-authored Vega chart — wandb does not export its spec
      </p>
      <p className="font-mono text-[10px] text-muted-foreground">
        data is in the “{panel.tableKey}” table
      </p>
    </div>
  );
}

export function CustomChartView({
  panel,
  tenantId,
  projectName,
  runId,
  runName,
  className,
}: CustomChartViewProps) {
  const { data, isLoading } = useQuery(
    trpc.runs.data.table.queryOptions({
      organizationId: tenantId,
      projectName,
      runId,
      logName: panel.tableKey,
    }),
  );

  const table = useMemo(() => latestTable(data), [data]);

  const built = useMemo(
    () =>
      table
        ? buildVegaSpec(panel, [
            { runName: runName || runId, color: DEFAULT_SERIES_COLOR, table },
          ])
        : null,
    [table, panel, runId, runName],
  );

  const title = panel.title || panel.key;

  if (isLoading) {
    return (
      <div className={cn("flex h-full flex-col gap-2 p-4", className)}>
        <Skeleton className="mx-auto h-4 w-24" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <MediaCardWrapper title={title} className="h-full w-full">
      <div
        data-testid="custom-chart-widget"
        className={cn("flex h-full min-h-0 flex-col gap-1 p-4", className)}
      >
        {built ? (
          <VegaChart spec={built.spec} controls={built.controls} title={title} />
        ) : (
          <>
            <h3 className="truncate text-center font-mono text-sm font-medium">{title}</h3>
            {!table ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                No table data for this run
              </div>
            ) : (
              <CustomChartFallback panel={panel} />
            )}
          </>
        )}
      </div>
    </MediaCardWrapper>
  );
}
