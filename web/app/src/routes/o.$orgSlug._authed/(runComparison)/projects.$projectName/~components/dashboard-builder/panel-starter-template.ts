// Starter config for new Python panel widgets.
//
// MIRROR of createDefaultWidgetConfig("panel") in
// web/server/lib/dashboard-types.ts (DEFAULT_PANEL_CODE) — the app
// cannot import server modules, so keep the two in sync by hand like
// the rest of the dashboard-types mirror.

import type { PanelWidgetConfig } from "../../~types/dashboard-types";

const DEFAULT_PANEL_CODE = `import streamlit as st
import mlop

ctx = mlop.get_context()
st.title("My Panel")
st.caption(f"Project: {ctx.project} — {len(ctx.runs)} run(s) selected")

names = await mlop.get_metric_names()
if not names:
    st.info("No metrics logged in this project yet.")
    st.stop()

metric = st.selectbox("Metric", names)
df = await mlop.get_metrics(metrics=[metric])
st.line_chart(df, x="step", y="value", color="run_name")
`;

export function createStarterPanelConfig(): PanelWidgetConfig {
  return {
    code: DEFAULT_PANEL_CODE,
    requirements: [],
    autoRunOnRunChange: false,
  };
}
