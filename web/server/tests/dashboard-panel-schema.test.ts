/**
 * Panel Widget Schema Validation Tests
 *
 * Direct Zod-level tests for the "panel" dashboard widget type
 * (user-authored Python/Streamlit panels — see PanelWidgetConfigSchema
 * in lib/dashboard-types.ts). These exercise the exact schema that
 * dashboardViews.create/update parse, so they cover the storage
 * contract even when the HTTP-level Suite 15 tests skip for lack of a
 * session (see smoke.test.ts Tests 15.13–15.16 for the wire-level
 * versions).
 *
 * Run with: vitest run tests/dashboard-panel-schema.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  DashboardViewConfigSchema,
  WidgetSchema,
  PanelWidgetConfigSchema,
  createDefaultWidgetConfig,
} from '../lib/dashboard-types';

const layout = { x: 0, y: 0, w: 6, h: 4 };

const wrapWidgets = (widgets: unknown[]) => ({
  version: 1,
  sections: [{ id: 's', name: 'S', collapsed: false, widgets }],
  settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' },
});

const panelWidget = (config: Record<string, unknown>) => ({
  id: 'w-panel',
  type: 'panel',
  config,
  layout,
});

describe('Panel Widget Schema', () => {
  it('parses a valid panel widget and applies defaults', () => {
    const result = DashboardViewConfigSchema.safeParse(
      wrapWidgets([panelWidget({ code: 'import mlop' })]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const config = result.data.sections[0].widgets[0].config as Record<string, unknown>;
      expect(config.code).toBe('import mlop');
      expect(config.requirements).toEqual([]);
      expect(config.autoRunOnRunChange).toBe(false);
    }
  });

  it('round-trips all fields including panelId (reserved for the V2 library)', () => {
    const result = DashboardViewConfigSchema.safeParse(
      wrapWidgets([
        panelWidget({
          title: 'My Panel',
          code: 'import streamlit as st',
          requirements: ['seaborn', 'plotly'],
          autoRunOnRunChange: true,
          panelId: 'lib-panel-1',
        }),
      ]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const config = result.data.sections[0].widgets[0].config as Record<string, unknown>;
      expect(config).toMatchObject({
        title: 'My Panel',
        code: 'import streamlit as st',
        requirements: ['seaborn', 'plotly'],
        autoRunOnRunChange: true,
        panelId: 'lib-panel-1',
      });
    }
  });

  it('accepts code at exactly the 64KB cap and rejects one char over', () => {
    expect(
      DashboardViewConfigSchema.safeParse(
        wrapWidgets([panelWidget({ code: 'x'.repeat(65536) })]),
      ).success,
    ).toBe(true);
    expect(
      DashboardViewConfigSchema.safeParse(
        wrapWidgets([panelWidget({ code: 'x'.repeat(65537) })]),
      ).success,
    ).toBe(false);
  });

  it('rejects a panel widget with missing or empty code', () => {
    expect(
      DashboardViewConfigSchema.safeParse(
        wrapWidgets([panelWidget({ requirements: [] })]),
      ).success,
    ).toBe(false);
    expect(
      DashboardViewConfigSchema.safeParse(
        wrapWidgets([panelWidget({ code: '' })]),
      ).success,
    ).toBe(false);
  });

  it('enforces requirements caps (≤20 entries, each ≤100 chars, non-empty)', () => {
    expect(
      DashboardViewConfigSchema.safeParse(
        wrapWidgets([panelWidget({ code: 'x', requirements: Array(20).fill('pkg') })]),
      ).success,
    ).toBe(true);
    expect(
      DashboardViewConfigSchema.safeParse(
        wrapWidgets([panelWidget({ code: 'x', requirements: Array(21).fill('pkg') })]),
      ).success,
    ).toBe(false);
    expect(
      DashboardViewConfigSchema.safeParse(
        wrapWidgets([panelWidget({ code: 'x', requirements: ['p'.repeat(101)] })]),
      ).success,
    ).toBe(false);
    expect(
      DashboardViewConfigSchema.safeParse(
        wrapWidgets([panelWidget({ code: 'x', requirements: [''] })]),
      ).success,
    ).toBe(false);
  });

  it('superRefine rejects cross-type config confusion in both directions', () => {
    // type "panel" with a chart-shaped config
    expect(
      WidgetSchema.safeParse({
        id: 'w',
        type: 'panel',
        config: { metrics: ['loss'] },
        layout,
      }).success,
    ).toBe(false);
    // type "chart" with a panel-shaped config
    expect(
      WidgetSchema.safeParse({
        id: 'w',
        type: 'chart',
        config: { code: 'import mlop' },
        layout,
      }).success,
    ).toBe(false);
  });

  it('does not disturb other widget types (union ordering regression)', () => {
    // logs config must keep its fields (panel is last in the union, but
    // guard against future reordering silently stripping keys)
    const logs = WidgetSchema.safeParse({
      id: 'w',
      type: 'logs',
      config: { logName: 'stdout', maxLines: 50 },
      layout,
    });
    expect(logs.success).toBe(true);
    if (logs.success) {
      expect((logs.data.config as Record<string, unknown>).maxLines).toBe(50);
    }
  });

  it('legacy configs without panel widgets still parse (regression)', () => {
    const legacy = wrapWidgets([
      {
        id: 'w-chart',
        type: 'chart',
        config: {
          metrics: ['loss'],
          xAxis: 'step',
          yAxisScale: 'linear',
          xAxisScale: 'linear',
          aggregation: 'LAST',
          showOriginal: false,
        },
        layout,
      },
    ]);
    const result = DashboardViewConfigSchema.safeParse(legacy);
    expect(result.success).toBe(true);
  });

  it('createDefaultWidgetConfig("panel") returns a valid starter template', () => {
    const config = createDefaultWidgetConfig('panel');
    expect(PanelWidgetConfigSchema.safeParse(config).success).toBe(true);
    const code = (config as { code: string }).code;
    expect(code).toContain('import mlop');
    expect(code).toContain('mlop.get_context()');
    expect(code).toContain('await mlop.get_metrics(');
    expect(code).toContain('st.line_chart');
    expect(
      WidgetSchema.safeParse({ id: 'w', type: 'panel', config, layout }).success,
    ).toBe(true);
  });
});
