/**
 * MCP → backend dashboard-config contract tests.
 *
 * The MCP server's dashboard tools (`mcp/src/pluto_mcp_server/dashboards.py`)
 * build DashboardViewConfig JSON in Python, but the schema that accepts it on
 * `POST /api/dashboards/create` is Zod, here in TypeScript. Neither language's
 * own tests can see both sides, so a drift between them would only surface as a
 * 400 at runtime for every dashboard an agent tries to create.
 *
 * The shared fixture records, per case, the compact spec an agent writes and the
 * config the Python builder produced from it. This file parses each recorded
 * config through the REAL schema the endpoint uses. The Python half
 * (`mcp/tests/test_dashboard_contract.py`) asserts the builder still emits those
 * same configs, so the fixture cannot go stale.
 *
 * Regenerate after changing either side:
 *   cd mcp && python scripts/generate_dashboard_fixture.py
 *
 * Run with: vitest run tests/mcp-dashboard-contract.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ChartWidgetConfigSchema,
  DashboardViewConfigSchema,
  DistributionsBarsEntrySchema,
  DistributionsHistogramEntrySchema,
  DistributionsWidgetConfigSchema,
  FileGroupWidgetConfigSchema,
  FileSeriesWidgetConfigSchema,
  LogsWidgetConfigSchema,
  ScatterWidgetConfigSchema,
  SingleValueWidgetConfigSchema,
  SmoothingConfigSchema,
  StringSeriesWidgetConfigSchema,
  WidgetTypeSchema,
  type Section,
  type WidgetType,
} from '../lib/dashboard-types';

/**
 * The authoritative config schema per widget type, used here in STRICT mode.
 *
 * The production schemas are `.passthrough()` (deliberately — they must not
 * strip forward-compat keys the server does not model yet). That tolerance is
 * exactly why a plain parse cannot catch the most likely drift between the
 * Python builder and this schema: a misnamed optional field. `y_axis_scale`
 * instead of `yAxisScale` passes through untouched while `yAxisScale` quietly
 * takes its default, so the dashboard renders with the wrong axis and nothing
 * errors. Strict-parsing here turns that silent downgrade into a test failure.
 */
const STRICT_CONFIG_SCHEMAS: Partial<Record<WidgetType, z.AnyZodObject>> = {
  chart: ChartWidgetConfigSchema,
  scatter: ScatterWidgetConfigSchema,
  'single-value': SingleValueWidgetConfigSchema,
  logs: LogsWidgetConfigSchema,
  'file-series': FileSeriesWidgetConfigSchema,
  'file-group': FileGroupWidgetConfigSchema,
  distributions: DistributionsWidgetConfigSchema,
  'string-series': StringSeriesWidgetConfigSchema,
};

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'mcp-dashboard-configs.json',
);

const REGEN_HINT =
  'Run `cd mcp && python scripts/generate_dashboard_fixture.py` to regenerate it.';

interface ContractCase {
  name: string;
  description: string;
  sections: unknown[];
  config: unknown;
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as {
  cases: ContractCase[];
};

/** Collect every widget across a config's sections, including child sections. */
function allWidgets(sections: Section[]): Section['widgets'] {
  return sections.flatMap((section) => [
    ...section.widgets,
    ...(section.children ? allWidgets(section.children) : []),
  ]);
}

describe('MCP dashboard config contract', () => {
  it('fixture is present and non-empty', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  describe.each(fixture.cases)('case: $name', (testCase) => {
    it('parses against the schema the create endpoint uses', () => {
      const result = DashboardViewConfigSchema.safeParse(testCase.config);

      if (!result.success) {
        throw new Error(
          `The MCP builder's output for '${testCase.name}' (${testCase.description}) is ` +
            `rejected by DashboardViewConfigSchema, so create_dashboard would 400.\n` +
            `${REGEN_HINT}\n` +
            `Issues: ${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }

      expect(result.success).toBe(true);
    });

    it('survives a parse round-trip without losing widgets', () => {
      // `.passthrough()` on the per-type config schemas means a valid config
      // must come back out with the same widget count — a drop here would mean
      // the server silently discarded part of what the agent asked for.
      const parsed = DashboardViewConfigSchema.parse(testCase.config);
      const reparsed = DashboardViewConfigSchema.parse(parsed);

      expect(allWidgets(reparsed.sections).length).toBe(allWidgets(parsed.sections).length);
      expect(reparsed.sections.map((s) => s.name)).toEqual(parsed.sections.map((s) => s.name));
    });

    it('declares only widget types the server knows', () => {
      const parsed = DashboardViewConfigSchema.parse(testCase.config);

      for (const widget of allWidgets(parsed.sections)) {
        expect(WidgetTypeSchema.safeParse(widget.type).success).toBe(true);
      }
    });
  });

  it('exercises every widget type the server accepts', () => {
    // Guards the reverse direction: a widget type the MCP builder never emits
    // is a gap in this contract check, not a passing test.
    const covered = new Set(
      fixture.cases.flatMap((testCase) =>
        allWidgets(DashboardViewConfigSchema.parse(testCase.config).sections).map((w) => w.type),
      ),
    );

    // "histogram" is legacy parse-only — the UI and the MCP builder both emit
    // it as a `distributions` entry now, so it is deliberately not covered.
    const expected = WidgetTypeSchema.options.filter((type) => type !== 'histogram');
    const missing = expected.filter((type) => !covered.has(type));

    expect(missing, `Widget type(s) never validated against the schema. ${REGEN_HINT}`).toEqual(
      [],
    );
  });

  it('keeps dynamic sections widget-free', () => {
    // A dynamic section regenerates its widgets from its pattern at render
    // time; shipping stored widgets alongside a pattern would double-render.
    for (const testCase of fixture.cases) {
      const parsed = DashboardViewConfigSchema.parse(testCase.config);

      const walk = (sections: Section[]) => {
        for (const section of sections) {
          if (section.dynamicPattern) {
            expect(section.widgets, `${testCase.name}/${section.name}`).toEqual([]);
          }
          if (section.children) {
            walk(section.children);
          }
        }
      };

      walk(parsed.sections);
    }
  });

  it('emits no widget-config key the server does not model', () => {
    for (const testCase of fixture.cases) {
      const parsed = DashboardViewConfigSchema.parse(testCase.config);

      for (const widget of allWidgets(parsed.sections)) {
        const schema = STRICT_CONFIG_SCHEMAS[widget.type];
        if (!schema) {
          continue;
        }

        const result = schema.strict().safeParse(widget.config);
        expect(
          result.success,
          `${testCase.name}: ${widget.type} widget has key(s) the schema does not ` +
            `recognize — likely a naming drift that would silently fall back to ` +
            `defaults. ${REGEN_HINT}\n` +
            `${result.success ? '' : JSON.stringify(result.error.issues)}`,
        ).toBe(true);

        // `.strict()` does not recurse, so nested shapes are checked explicitly.
        const config = widget.config as Record<string, unknown>;
        if (config.smoothing) {
          expect(
            SmoothingConfigSchema.strict().safeParse(config.smoothing).success,
            `${testCase.name}: unrecognized key in smoothing config`,
          ).toBe(true);
        }
        if (Array.isArray(config.entries)) {
          for (const entry of config.entries) {
            const entrySchema =
              (entry as { kind?: string }).kind === 'bars'
                ? DistributionsBarsEntrySchema
                : DistributionsHistogramEntrySchema;
            expect(
              entrySchema.strict().safeParse(entry).success,
              `${testCase.name}: unrecognized key in distributions entry`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('emits no section key the server drops on parse', () => {
    // SectionSchema is NOT passthrough, so any key it does not model is stripped
    // during parse. Comparing the recorded keys against the parsed ones catches
    // a misnamed section field (e.g. `dynamic_pattern`), which would otherwise
    // turn a dynamic section into a silently empty static one.
    for (const testCase of fixture.cases) {
      const recorded = testCase.config as { sections: Record<string, unknown>[] };
      const parsed = DashboardViewConfigSchema.parse(testCase.config);

      const walk = (
        recordedSections: Record<string, unknown>[],
        parsedSections: Section[],
        path: string,
      ) => {
        recordedSections.forEach((recordedSection, index) => {
          const parsedSection = parsedSections[index];
          expect(parsedSection, `${testCase.name}: missing section at ${path}[${index}]`).toBeDefined();

          const dropped = Object.keys(recordedSection).filter(
            (key) => !(key in (parsedSection as unknown as Record<string, unknown>)),
          );
          expect(
            dropped,
            `${testCase.name}: section '${recordedSection.name}' key(s) dropped by the ` +
              `schema — the server never sees them. ${REGEN_HINT}`,
          ).toEqual([]);

          const recordedChildren = recordedSection.children as
            | Record<string, unknown>[]
            | undefined;
          if (recordedChildren) {
            walk(recordedChildren, parsedSection.children ?? [], `${path}[${index}].children`);
          }
        });
      };

      walk(recorded.sections, parsed.sections, 'sections');
    }
  });

  it('keeps every widget inside the 12-column grid', () => {
    for (const testCase of fixture.cases) {
      const parsed = DashboardViewConfigSchema.parse(testCase.config);

      for (const widget of allWidgets(parsed.sections)) {
        expect(
          widget.layout.x + widget.layout.w,
          `${testCase.name}: widget ${widget.id} overflows the grid`,
        ).toBeLessThanOrEqual(parsed.settings.gridCols);
      }
    }
  });
});
