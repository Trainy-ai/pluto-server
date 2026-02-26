/**
 * Data Schema Validation Tests
 *
 * Tests for the Zod schemas used to parse ClickHouse responses in
 * histogram and table data procedures. These schemas must handle
 * ClickHouse returning `step` as either a string or a number.
 *
 * Run with: vitest run tests/data-schemas.test.ts
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { histogramDataRow } from '../trpc/routers/runs/routers/data/procs/histogram.schema';
import { tableDataRow } from '../trpc/routers/runs/routers/data/procs/table.schema';

// --- Test Data ---

const VALID_HISTOGRAM_JSON = JSON.stringify({
  freq: [1, 5, 10, 3],
  bins: { min: 0.0, max: 1.0, num: 4 },
  shape: 'uniform',
  type: 'Histogram',
  maxFreq: 10,
});

const VALID_TABLE_JSON = JSON.stringify({
  col: [
    { name: 'epoch', dtype: 'int' },
    { name: 'loss', dtype: 'float' },
  ],
  table: [
    [1, 0.5],
    [2, 0.3],
  ],
});

// ============================================================================
// Test Suite: Histogram Data Row Schema
// ============================================================================

describe('Histogram Data Row Schema', () => {
  it('parses step as a string (ClickHouse default)', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: '42',
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.step).toBe(42);
    expect(typeof result.step).toBe('number');
  });

  it('parses step as a number', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 100,
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.step).toBe(100);
    expect(typeof result.step).toBe('number');
  });

  it('parses step "0" correctly', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: '0',
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.step).toBe(0);
  });

  it('parses large step values as strings', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: '999999',
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.step).toBe(999999);
  });

  it('parses time into a Date object', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 1,
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.time).toBeInstanceOf(Date);
  });

  it('parses histogram JSON data correctly', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 1,
      histogramData: VALID_HISTOGRAM_JSON,
    };

    const result = histogramDataRow.parse(row);
    expect(result.histogramData.freq).toEqual([1, 5, 10, 3]);
    expect(result.histogramData.bins.min).toBe(0.0);
    expect(result.histogramData.bins.max).toBe(1.0);
    expect(result.histogramData.shape).toBe('uniform');
    expect(result.histogramData.type).toBe('Histogram');
    expect(result.histogramData.maxFreq).toBe(10);
  });

  it('rejects non-numeric step strings', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 'abc',
      histogramData: VALID_HISTOGRAM_JSON,
    };

    expect(() => histogramDataRow.parse(row)).toThrow();
  });

  it('rejects invalid histogram JSON', () => {
    const row = {
      logName: 'train/weights',
      time: '2026-01-15 10:30:00',
      step: 1,
      histogramData: JSON.stringify({ invalid: true }),
    };

    expect(() => histogramDataRow.parse(row)).toThrow();
  });
});

// ============================================================================
// Test Suite: Table Data Row Schema
// ============================================================================

describe('Table Data Row Schema', () => {
  it('parses step as a string (ClickHouse default)', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: '42',
      tableData: VALID_TABLE_JSON,
    };

    const result = tableDataRow.parse(row);
    expect(result.step).toBe(42);
    expect(typeof result.step).toBe('number');
  });

  it('parses step as a number', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: 100,
      tableData: VALID_TABLE_JSON,
    };

    const result = tableDataRow.parse(row);
    expect(result.step).toBe(100);
    expect(typeof result.step).toBe('number');
  });

  it('parses step "0" correctly', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: '0',
      tableData: VALID_TABLE_JSON,
    };

    const result = tableDataRow.parse(row);
    expect(result.step).toBe(0);
  });

  it('parses table JSON data correctly', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: 1,
      tableData: VALID_TABLE_JSON,
    };

    const result = tableDataRow.parse(row);
    expect(result.tableData.table).toEqual([
      [1, 0.5],
      [2, 0.3],
    ]);
    expect(result.tableData.col).toHaveLength(2);
  });

  it('parses table without optional row/col labels', () => {
    const minimalTable = JSON.stringify({
      table: [[1, 2], [3, 4]],
    });

    const row = {
      logName: 'eval/data',
      time: '2026-01-15 10:30:00',
      step: '5',
      tableData: minimalTable,
    };

    const result = tableDataRow.parse(row);
    expect(result.tableData.row).toBeUndefined();
    expect(result.tableData.col).toBeUndefined();
    expect(result.tableData.table).toEqual([[1, 2], [3, 4]]);
  });

  it('parses table with mixed string/number values', () => {
    const mixedTable = JSON.stringify({
      col: [
        { name: 'label', dtype: 'str' },
        { name: 'value', dtype: 'float' },
      ],
      table: [
        ['cat', 0.9],
        ['dog', 0.8],
      ],
    });

    const row = {
      logName: 'eval/predictions',
      time: '2026-01-15 10:30:00',
      step: 1,
      tableData: mixedTable,
    };

    const result = tableDataRow.parse(row);
    expect(result.tableData.table[0]).toEqual(['cat', 0.9]);
  });

  it('rejects non-numeric step strings', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: 'abc',
      tableData: VALID_TABLE_JSON,
    };

    expect(() => tableDataRow.parse(row)).toThrow();
  });

  it('rejects invalid table JSON', () => {
    const row = {
      logName: 'eval/confusion_matrix',
      time: '2026-01-15 10:30:00',
      step: 1,
      tableData: JSON.stringify({ notATable: true }),
    };

    expect(() => tableDataRow.parse(row)).toThrow();
  });
});

// ============================================================================
// Test Suite: Schema Regression — z.string().transform(parseInt) vs z.coerce.number()
// ============================================================================

describe('Schema Regression: step field parsing', () => {
  it('z.coerce.number() handles string "42" correctly', () => {
    const schema = z.coerce.number();
    expect(schema.parse('42')).toBe(42);
  });

  it('z.coerce.number() handles number 42 correctly', () => {
    const schema = z.coerce.number();
    expect(schema.parse(42)).toBe(42);
  });

  it('z.string().transform(parseInt) REJECTS number input (the original bug)', () => {
    const brokenSchema = z.string().transform((str) => parseInt(str, 10));
    // This is the bug: if ClickHouse returns a number, z.string() rejects it
    expect(() => brokenSchema.parse(42)).toThrow();
  });

  it('z.coerce.number() rejects NaN-producing strings', () => {
    const schema = z.coerce.number();
    expect(() => schema.parse('not-a-number')).toThrow();
  });
});

// ============================================================================
// Test Suite: Dashboard Widget Schema
//
// Guards against z.union silently stripping/corrupting widget config properties.
// The root cause: z.union matches the FIRST schema whose required fields are
// present, then strips keys that schema doesn't recognize. Schemas that share
// fields (e.g. LogsWidgetConfig and FileSeriesWidgetConfig both have `logName`)
// can match the wrong branch, silently deleting type-specific properties.
// ============================================================================

import {
  DashboardViewConfigSchema,
  WidgetSchema,
  WidgetConfigSchema,
  createDefaultWidgetConfig,
  type WidgetType,
} from '../lib/dashboard-types';

// -- helpers --

const layout = { x: 0, y: 0, w: 6, h: 4 };
let nextId = 0;
function mkWidget(type: string, config: Record<string, unknown>) {
  return { id: `w-${++nextId}`, type, config, layout };
}

/**
 * Canonical valid configs for every widget type.
 * Each contains the exact properties the frontend sends on save.
 */
const VALID_CONFIGS: Record<WidgetType, Record<string, unknown>> = {
  chart: {
    metrics: ['train/loss', 'val/loss'],
    xAxis: 'step',
    yAxisScale: 'linear',
    xAxisScale: 'linear',
    aggregation: 'LAST',
    showOriginal: false,
  },
  scatter: {
    xMetric: 'lr',
    yMetric: 'loss',
    xScale: 'linear',
    yScale: 'log',
    xAggregation: 'LAST',
    yAggregation: 'AVG',
  },
  'single-value': {
    metric: 'train/accuracy',
    aggregation: 'MAX',
    format: '0.00%',
    prefix: '',
    suffix: '%',
  },
  histogram: {
    metric: 'layer1/weights',
    bins: 64,
    step: 'last',
  },
  logs: {
    logName: 'stdout',
    maxLines: 500,
  },
  'file-group': {
    files: ['histograms/*.json', 'images/*.png'],
  },
  'file-series': {
    logName: 'generated_images',
    mediaType: 'IMAGE',
  },
};

// ============================================================================
// Suite 1: Every widget type validates with its canonical config
// ============================================================================

describe('Dashboard WidgetSchema: valid configs accepted', () => {
  const widgetTypes = Object.keys(VALID_CONFIGS) as WidgetType[];

  it.each(widgetTypes)('%s widget validates successfully', (type) => {
    const widget = mkWidget(type, VALID_CONFIGS[type]);
    const result = WidgetSchema.safeParse(widget);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Suite 2: z.union must NOT strip type-specific properties
//
// This is the exact regression that caused the "mediaType Required" bug:
// LogsWidgetConfig matched file-series data, stripped mediaType.
// We test every type's distinguishing keys survive the round-trip.
// ============================================================================

describe('Dashboard WidgetSchema: union does not strip config properties', () => {
  const KEY_PROPERTIES: Record<WidgetType, string[]> = {
    chart: ['metrics', 'xAxis', 'yAxisScale', 'xAxisScale', 'aggregation', 'showOriginal'],
    scatter: ['xMetric', 'yMetric', 'xScale', 'yScale', 'xAggregation', 'yAggregation'],
    'single-value': ['metric', 'aggregation'],
    histogram: ['metric', 'bins', 'step'],
    'file-group': ['files'],
    logs: ['logName', 'maxLines'],
    'file-series': ['logName', 'mediaType'],
  };

  for (const [type, keys] of Object.entries(KEY_PROPERTIES)) {
    it(`${type}: all keys [${keys.join(', ')}] survive parse`, () => {
      const widget = mkWidget(type, VALID_CONFIGS[type as WidgetType]);
      const result = WidgetSchema.safeParse(widget);
      expect(result.success).toBe(true);
      if (!result.success) return;

      for (const key of keys) {
        expect(result.data.config).toHaveProperty(key, VALID_CONFIGS[type as WidgetType][key]);
      }
    });
  }

  // Explicit regression: the exact scenario that failed before the fix
  it('regression: file-series mediaType is not stripped by LogsWidgetConfig match', () => {
    for (const mediaType of ['IMAGE', 'VIDEO', 'AUDIO'] as const) {
      const widget = mkWidget('file-series', { logName: 'media_log', mediaType });
      const result = WidgetSchema.safeParse(widget);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config).toHaveProperty('mediaType', mediaType);
      }
    }
  });
});

// ============================================================================
// Suite 3: Type mismatch — wrong config for declared type is rejected
// ============================================================================

describe('Dashboard WidgetSchema: type/config mismatch rejected', () => {
  it('chart type with logs config is rejected', () => {
    const result = WidgetSchema.safeParse(mkWidget('chart', VALID_CONFIGS.logs));
    expect(result.success).toBe(false);
  });

  it('file-series type with chart config is rejected', () => {
    const result = WidgetSchema.safeParse(mkWidget('file-series', VALID_CONFIGS.chart));
    expect(result.success).toBe(false);
  });

  it('scatter type with histogram config is rejected', () => {
    const result = WidgetSchema.safeParse(mkWidget('scatter', VALID_CONFIGS.histogram));
    expect(result.success).toBe(false);
  });

  it('logs type with file-series config passes (extra mediaType is harmless)', () => {
    const result = WidgetSchema.safeParse(
      mkWidget('logs', { logName: 'output', maxLines: 100, mediaType: 'IMAGE' })
    );
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Suite 4: Missing required fields are rejected per type
// ============================================================================

describe('Dashboard WidgetSchema: missing required fields rejected', () => {
  it('file-series without mediaType is rejected', () => {
    const result = WidgetSchema.safeParse(
      mkWidget('file-series', { logName: 'images' })
    );
    expect(result.success).toBe(false);
  });

  it('file-series without logName is rejected', () => {
    const result = WidgetSchema.safeParse(
      mkWidget('file-series', { mediaType: 'IMAGE' })
    );
    expect(result.success).toBe(false);
  });

  it('chart without metrics is rejected', () => {
    const result = WidgetSchema.safeParse(
      mkWidget('chart', { xAxis: 'step', yAxisScale: 'linear' })
    );
    expect(result.success).toBe(false);
  });

  it('scatter without xMetric is rejected', () => {
    const result = WidgetSchema.safeParse(
      mkWidget('scatter', { yMetric: 'loss' })
    );
    expect(result.success).toBe(false);
  });

  it('single-value without metric is rejected', () => {
    const result = WidgetSchema.safeParse(
      mkWidget('single-value', {})
    );
    expect(result.success).toBe(false);
  });

  it('histogram without metric is rejected', () => {
    const result = WidgetSchema.safeParse(
      mkWidget('histogram', { bins: 50 })
    );
    expect(result.success).toBe(false);
  });

  it('logs without logName is rejected', () => {
    const result = WidgetSchema.safeParse(
      mkWidget('logs', { maxLines: 100 })
    );
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Suite 5: WidgetConfigSchema union directly (isolated from superRefine)
// ============================================================================

describe('WidgetConfigSchema union: property preservation', () => {
  it('file-series config retains mediaType through union parse', () => {
    const input = { logName: 'gen_images', mediaType: 'VIDEO' };
    const result = WidgetConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('mediaType', 'VIDEO');
    }
  });

  it('chart config with optional fields retains them', () => {
    const input = {
      metrics: ['loss'],
      xAxis: 'step',
      smoothing: { algorithm: 'exponential', parameter: 0.6 },
      yMin: -1,
      yMax: 10,
    };
    const result = WidgetConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('smoothing');
      expect(result.data).toHaveProperty('yMin', -1);
      expect(result.data).toHaveProperty('yMax', 10);
    }
  });
});

// ============================================================================
// Suite 6: createDefaultWidgetConfig round-trips through WidgetSchema
// ============================================================================

describe('createDefaultWidgetConfig round-trips through WidgetSchema', () => {
  const widgetTypes: WidgetType[] = [
    'chart', 'scatter', 'single-value', 'histogram', 'file-group', 'logs', 'file-series',
  ];

  it.each(widgetTypes)('%s default config validates', (type) => {
    const config = createDefaultWidgetConfig(type);
    const widget = { id: 'default-test', type, config, layout };
    const result = WidgetSchema.safeParse(widget);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Suite 7: Full DashboardViewConfig with every widget type (simulates save)
// ============================================================================

describe('DashboardViewConfigSchema: full dashboard save', () => {
  it('dashboard with one widget of every type validates', () => {
    const widgetTypes = Object.keys(VALID_CONFIGS) as WidgetType[];
    const dashboardConfig = {
      version: 1,
      sections: widgetTypes.map((type, i) => ({
        id: `section-${i}`,
        name: `Section ${type}`,
        collapsed: false,
        widgets: [
          {
            id: `widget-${i}`,
            type,
            config: VALID_CONFIGS[type],
            layout: { x: 0, y: i * 4, w: 6, h: 4 },
          },
        ],
      })),
      settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' as const },
    };

    const result = DashboardViewConfigSchema.safeParse(dashboardConfig);
    expect(result.success).toBe(true);
  });

  it('dashboard with multiple file-series widgets across sections validates', () => {
    const mediaTypes = ['IMAGE', 'VIDEO', 'AUDIO'] as const;
    const dashboardConfig = {
      version: 1,
      sections: Array.from({ length: 12 }, (_, i) => ({
        id: `section-${i}`,
        name: `Section ${i}`,
        collapsed: false,
        widgets: [
          {
            id: `widget-${i}`,
            type: i % 3 === 0 ? 'file-series' : i % 3 === 1 ? 'chart' : 'logs',
            config:
              i % 3 === 0
                ? { logName: `media_${i}`, mediaType: mediaTypes[i % 3] }
                : i % 3 === 1
                  ? VALID_CONFIGS.chart
                  : VALID_CONFIGS.logs,
            layout: { x: 0, y: i * 4, w: 6, h: 4 },
          },
        ],
      })),
      settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' as const },
    };

    const result = DashboardViewConfigSchema.safeParse(dashboardConfig);
    expect(result.success).toBe(true);
  });

  it('parse-then-reparse is stable (simulates save → load → save)', () => {
    const original = {
      version: 1,
      sections: [
        {
          id: 's1',
          name: 'Charts',
          collapsed: false,
          widgets: [
            { id: 'w1', type: 'chart', config: VALID_CONFIGS.chart, layout },
            { id: 'w2', type: 'scatter', config: VALID_CONFIGS.scatter, layout },
          ],
        },
        {
          id: 's2',
          name: 'Media',
          collapsed: false,
          widgets: [
            { id: 'w3', type: 'file-series', config: { logName: 'imgs', mediaType: 'IMAGE' }, layout },
            { id: 'w4', type: 'logs', config: { logName: 'stdout', maxLines: 100 }, layout },
          ],
        },
      ],
      settings: { gridCols: 12, rowHeight: 80, compactType: 'vertical' as const },
    };

    // First parse (save)
    const first = DashboardViewConfigSchema.parse(original);
    // Second parse (load from DB → save again)
    const second = DashboardViewConfigSchema.safeParse(first);

    expect(second.success).toBe(true);
    if (!second.success) return;

    // file-series widget must retain mediaType across both parses
    const mediaWidget = second.data.sections[1].widgets[0];
    expect(mediaWidget.config).toHaveProperty('mediaType', 'IMAGE');

    // logs widget must retain its properties too
    const logsWidget = second.data.sections[1].widgets[1];
    expect(logsWidget.config).toHaveProperty('logName', 'stdout');
  });
});
