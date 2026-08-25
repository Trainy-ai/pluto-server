// Starter config for new Python panel widgets.
//
// The starter is the first entry of the built-in template gallery
// (lib/panels/panel-templates.ts). Its code is a MIRROR of
// createDefaultWidgetConfig("panel") in web/server/lib/dashboard-types.ts
// (DEFAULT_PANEL_CODE) — the app cannot import server modules, so keep
// the two in sync by hand like the rest of the dashboard-types mirror.

import { PANEL_TEMPLATES } from "@/lib/panels/panel-templates";
import type { PanelWidgetConfig } from "../../~types/dashboard-types";

export function createStarterPanelConfig(): PanelWidgetConfig {
  const starter = PANEL_TEMPLATES[0];
  return {
    code: starter.code,
    requirements: [...starter.requirements],
    autoRunOnRunChange: false,
  };
}
