// Python Panels — built-in starter-template gallery.
//
// A small curated set of example panels selectable from the panel
// editor's "Templates" menu. Selecting one replaces the current draft
// (code + requirements) after a dirty-confirm; the template code is
// snapshotted into the widget config on save exactly like hand-written
// code — templates are seeds, not linked references.
//
// RULES for template code:
//   • Only the documented `mlop` SDK surface (src/lib/panels/mlop_sdk.py)
//     — data methods are async and require top-level `await`.
//   • Only packages available offline: the vendored Pyodide distribution
//     (numpy/pandas/matplotlib/…) plus the pure wheels injected into the
//     vendored pyodide-lock.json (seaborn, plotly). The sandbox CSP
//     blocks PyPI by design, so anything else fails to install.
//   • Degrade gracefully on empty projects (st.info + st.stop()) — a
//     template must never traceback just because nothing is logged yet.
//
// The first template mirrors DEFAULT_PANEL_CODE in panel-starter-template.ts
// (which itself mirrors createDefaultWidgetConfig("panel") on the server).

export interface PanelTemplate {
  /** Stable identifier (used as the menu key + test id suffix). */
  id: string;
  name: string;
  description: string;
  code: string;
  /** Extra micropip requirements the template needs (vendored wheels only). */
  requirements: string[];
}

const METRIC_LINE_CHART = `import streamlit as st
import mlop

ctx = mlop.get_context()
st.title("My Panel")
st.caption(f"Project: {ctx.project} — {len(ctx.runs)} run(s) selected")

names = await mlop.get_metric_names()
if not names or not ctx.runs:
    st.info("Select at least one run in a project with logged metrics.")
    st.stop()

metric = st.selectbox("Metric", names)
df = await mlop.get_metrics(metrics=[metric])
st.line_chart(df, x="step", y="value", color="run_name")
`;

const RUN_COMPARISON_TABLE = `import pandas as pd
import streamlit as st
import mlop

ctx = mlop.get_context()
st.subheader("Run comparison")

names = await mlop.get_metric_names()
if not names or not ctx.runs:
    st.info("Select at least one run in a project with logged metrics.")
    st.stop()

metrics = st.multiselect("Metrics", names, default=names[: min(5, len(names))])
if not metrics:
    st.info("Pick at least one metric.")
    st.stop()

summaries = await mlop.get_metric_summaries(metrics, aggregation="LAST")
rows = []
for run in ctx.runs:
    values = summaries.get(run.id, {})
    rows.append({"run": run.name, **{m: values.get(m) for m in metrics}})
st.dataframe(pd.DataFrame(rows).set_index("run"))
`;

const CORRELATION_HEATMAP = `import streamlit as st
import matplotlib.pyplot as plt
import seaborn as sns
import mlop

st.subheader("Metric correlation")

ctx = mlop.get_context()
names = await mlop.get_metric_names()
if len(names) < 2 or not ctx.runs:
    st.info("Select at least one run in a project with two or more metrics.")
    st.stop()

metrics = st.multiselect(
    "Metrics", names, default=names[: min(8, len(names))]
)
if len(metrics) < 2:
    st.info("Pick at least two metrics.")
    st.stop()

df = await mlop.get_metrics(metrics=metrics)
if df.empty:
    st.info("No data points for the selected runs.")
    st.stop()

wide = df.pivot_table(index=["run_id", "step"], columns="metric", values="value")
corr = wide.corr()

fig, ax = plt.subplots(figsize=(7, 5))
sns.heatmap(corr, annot=True, fmt=".2f", cmap="vlag", vmin=-1, vmax=1, ax=ax)
ax.set_xlabel("")
ax.set_ylabel("")
fig.tight_layout()
st.pyplot(fig)
`;

const PER_RUN_SUBPLOTS = `import math

import streamlit as st
import matplotlib.pyplot as plt
import mlop

ctx = mlop.get_context()
st.subheader("Per-run subplots")

names = await mlop.get_metric_names()
if not names or not ctx.runs:
    st.info("Select at least one run in a project with logged metrics.")
    st.stop()

metric = st.selectbox("Metric", names)
df = await mlop.get_metrics(metrics=[metric])

cols = min(3, len(ctx.runs))
rows = math.ceil(len(ctx.runs) / cols)
fig, axes = plt.subplots(
    rows, cols, figsize=(4 * cols, 3 * rows), squeeze=False, sharex=True, sharey=True
)
for i, run in enumerate(ctx.runs):
    ax = axes[i // cols][i % cols]
    series = df[df["run_id"] == run.id]
    ax.plot(series["step"], series["value"], color=run.color)
    ax.set_title(run.name, fontsize=9)
for j in range(len(ctx.runs), rows * cols):
    axes[j // cols][j % cols].axis("off")
fig.suptitle(metric)
fig.tight_layout()
st.pyplot(fig)
`;

const LOGS_VIEWER = `import streamlit as st
import mlop

ctx = mlop.get_context()
st.subheader("Console logs")

if not ctx.runs:
    st.info("Select at least one run.")
    st.stop()

run = st.selectbox("Run", ctx.runs, format_func=lambda r: r.name)
logs = await mlop.get_logs(run.id)
if not logs:
    st.info("No logs recorded for this run.")
    st.stop()

st.caption(f"{len(logs)} line(s) — showing the last 500")
st.code("\\n".join(entry["message"] for entry in logs[-500:]), language="text")
`;

const LEADERBOARD = `import streamlit as st
import matplotlib.pyplot as plt
import mlop

ctx = mlop.get_context()
st.subheader("Leaderboard")

names = await mlop.get_metric_names()
if not names or not ctx.runs:
    st.info("Select at least one run in a project with logged metrics.")
    st.stop()

metric = st.selectbox("Metric", names)
lower_is_better = st.toggle("Lower is better", value=True)

summaries = await mlop.get_metric_summaries([metric], aggregation="LAST")
scored = []
for run in ctx.runs:
    value = summaries.get(run.id, {}).get(metric)
    if value is not None:
        scored.append((run, value))
if not scored:
    st.info("No summary values for this metric yet.")
    st.stop()

# Best run on top; barh draws bottom-up, so reverse for display.
scored.sort(key=lambda item: item[1], reverse=not lower_is_better)
scored.reverse()

fig, ax = plt.subplots(figsize=(6, 0.5 * len(scored) + 1))
ax.barh(
    [run.name for run, _ in scored],
    [value for _, value in scored],
    color=[run.color for run, _ in scored],
)
ax.set_xlabel(metric)
fig.tight_layout()
st.pyplot(fig)
`;

export const PANEL_TEMPLATES: PanelTemplate[] = [
  {
    id: "metric-line-chart",
    name: "Metric line chart",
    description: "One metric across the selected runs, colored by run.",
    code: METRIC_LINE_CHART,
    requirements: [],
  },
  {
    id: "run-comparison-table",
    name: "Run comparison table",
    description: "Last value of chosen metrics per run in a dataframe.",
    code: RUN_COMPARISON_TABLE,
    requirements: [],
  },
  {
    id: "correlation-heatmap",
    name: "Correlation heatmap (seaborn)",
    description: "Pairwise correlation between metrics across all runs.",
    code: CORRELATION_HEATMAP,
    requirements: ["seaborn"],
  },
  {
    id: "per-run-subplots",
    name: "Per-run subplots (matplotlib)",
    description: "A small multiples grid — one subplot per selected run.",
    code: PER_RUN_SUBPLOTS,
    // matplotlib is vendored but NOT part of Streamlit's dependency set —
    // it only loads when requested (verified empirically: omitting it
    // raises ModuleNotFoundError; seaborn templates get it transitively).
    requirements: ["matplotlib"],
  },
  {
    id: "logs-viewer",
    name: "Logs viewer",
    description: "Console output of one run in a code block.",
    code: LOGS_VIEWER,
    requirements: [],
  },
  {
    id: "leaderboard",
    name: "Leaderboard bar chart",
    description: "Runs ranked by the last value of a metric.",
    code: LEADERBOARD,
    requirements: ["matplotlib"],
  },
];
