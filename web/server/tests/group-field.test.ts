import { describe, it, expect } from 'vitest';
import {
  parseGroupField,
  encodeGroupField,
  applyGroupFiltersToInput,
} from '../lib/group-field';

describe('group-field', () => {
  describe('parseGroupField', () => {
    it('parses a system field', () => {
      expect(parseGroupField('system:status')).toEqual({ kind: 'system', key: 'status' });
    });
    it('parses a config field with a dotted key', () => {
      expect(parseGroupField('config:model.lr')).toEqual({
        kind: 'config',
        key: 'model.lr',
      });
    });
    it('parses a tag-prefix field', () => {
      expect(parseGroupField('tag-prefix:group')).toEqual({
        kind: 'tag-prefix',
        key: 'group',
      });
    });
    it('rejects unknown kinds', () => {
      expect(parseGroupField('bogus:foo')).toBeNull();
    });
    it('rejects missing colon', () => {
      expect(parseGroupField('system')).toBeNull();
    });
    it('rejects trailing colon (empty key)', () => {
      expect(parseGroupField('config:')).toBeNull();
    });
    it('rejects leading colon (empty kind)', () => {
      expect(parseGroupField(':foo')).toBeNull();
    });
  });

  describe('encodeGroupField', () => {
    it('round-trips with parse', () => {
      const parsed = parseGroupField('config:lr')!;
      expect(encodeGroupField(parsed.kind, parsed.key)).toBe('config:lr');
    });
  });

  describe('applyGroupFiltersToInput', () => {
    it('returns input unchanged when there are no group filters', () => {
      const input = { tags: ['a'], status: ['RUNNING'] };
      const out = applyGroupFiltersToInput(input, [], new Map());
      expect(out).toEqual(input);
    });

    it('routes system:status → status array', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'system:status', value: 'COMPLETED' }],
        new Map(),
      );
      expect(out.status).toEqual(['COMPLETED']);
    });

    it('routes system:name → systemFilters[is]', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'system:name', value: 'foo' }],
        new Map(),
      );
      expect(out.systemFilters).toEqual([
        { field: 'name', operator: 'is', values: ['foo'] },
      ]);
    });

    it('skips null values for system fields', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'system:status', value: null }],
        new Map(),
      );
      // Null bucket for system fields is meaningless — they're NOT NULL
      // in the schema.
      expect(out.status).toBeUndefined();
      expect(out.systemFilters).toBeUndefined();
    });

    it('config:<text key> → fieldFilters[is, dataType=text]', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'config:activation', value: 'gelu' }],
        new Map([['config:activation', 'text']]),
      );
      expect(out.fieldFilters).toEqual([
        {
          source: 'config',
          key: 'activation',
          dataType: 'text',
          operator: 'is',
          values: ['gelu'],
        },
      ]);
    });

    it('config:<numeric key> → fieldFilters[is, dataType=number] with numeric value', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'config:batch_size', value: '32' }],
        new Map([['config:batch_size', 'number']]),
      );
      expect(out.fieldFilters).toEqual([
        {
          source: 'config',
          key: 'batch_size',
          dataType: 'number',
          operator: 'is',
          values: [32],
        },
      ]);
    });

    it('config null bucket → fieldFilters[not exists]', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'config:lr', value: null }],
        new Map([['config:lr', 'number']]),
      );
      expect(out.fieldFilters).toEqual([
        {
          source: 'config',
          key: 'lr',
          dataType: 'number',
          operator: 'not exists',
          values: [],
        },
      ]);
    });

    it('skips numeric filters whose value cannot be parsed', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'config:lr', value: 'not-a-number' }],
        new Map([['config:lr', 'number']]),
      );
      expect(out.fieldFilters).toBeUndefined();
    });

    it('defaults unknown dataType to text', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'config:unknown', value: 'foo' }],
        new Map(),
      );
      expect(out.fieldFilters?.[0]?.dataType).toBe('text');
    });

    it('tag-prefix:group with concrete value → tags array', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'tag-prefix:group', value: 'sweep-3' }],
        new Map(),
      );
      expect(out.tags).toEqual(['group:sweep-3']);
    });

    it('tag-prefix:group with null value → tagPrefixExclusions', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'tag-prefix:group', value: null }],
        new Map(),
      );
      // Drilling into the "no group:* tag" bucket pushes onto a
      // synthetic exclusions array consumed by the raw-SQL paths.
      expect(out.tagPrefixExclusions).toEqual(['group:']);
      expect(out.tags).toBeUndefined();
    });

    it('appends to existing filter arrays without dropping prior entries', () => {
      const out = applyGroupFiltersToInput(
        { tags: ['linear'], status: ['RUNNING'] },
        [
          { field: 'tag-prefix:group', value: 'alpha' },
          { field: 'system:status', value: 'COMPLETED' },
        ],
        new Map(),
      );
      expect(out.tags).toEqual(['linear', 'group:alpha']);
      // status array gets the extra entry appended; the listing path
      // ANDs both via `status: { in: [...] }` semantics.
      expect(out.status).toEqual(['RUNNING', 'COMPLETED']);
    });

    it('does not mutate the caller`s input arrays', () => {
      const input = {
        tags: ['linear'],
        fieldFilters: [],
        systemFilters: [],
      };
      const before = JSON.parse(JSON.stringify(input));
      applyGroupFiltersToInput(
        input,
        [{ field: 'tag-prefix:group', value: 'a' }],
        new Map(),
      );
      expect(input).toEqual(before);
    });

    it('skips unparseable fields', () => {
      const out = applyGroupFiltersToInput(
        {},
        [{ field: 'bogus:foo', value: 'x' }],
        new Map(),
      );
      expect(out).toEqual({});
    });
  });
});
