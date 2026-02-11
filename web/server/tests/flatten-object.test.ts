/**
 * Unit tests for the server-side flattenObject utility.
 *
 * When a user opens the column picker in the run table, they see a list of
 * available config and systemMetadata fields they can add as columns (e.g.
 * "optimizer.lr", "model.hidden_size", "gpu.name"). To build that list, the
 * backend's distinct-column-keys procedure fetches the last 300 runs and
 * flattens each run's config/systemMetadata JSON into dot-notation keys:
 *   { optimizer: { lr: 0.01 } }  -->  { "optimizer.lr": 0.01 }
 *
 * flattenObject does that conversion. It needs to handle arbitrary nesting
 * depths, preserve arrays as leaf values (e.g. hidden_sizes: [256, 128]),
 * and gracefully handle null/undefined inputs (runs with no config).
 *
 * The frontend has its own copy of this function (with an extra formatValue
 * helper for rendering cell values). They're kept in sync but live in
 * separate packages since the server can't import from the app.
 */

import { describe, it, expect } from 'vitest';
import { flattenObject } from '../lib/flatten-object';

describe('flattenObject (server)', () => {
  // --- Basic cases ---

  it('returns an empty object when given null', () => {
    expect(flattenObject(null)).toEqual({});
  });

  it('returns an empty object when given undefined', () => {
    expect(flattenObject(undefined)).toEqual({});
  });

  it('returns the same keys for a flat object', () => {
    const input = { lr: 0.01, epochs: 100 };
    expect(flattenObject(input)).toEqual({ lr: 0.01, epochs: 100 });
  });

  // --- Nested objects ---

  it('flattens one level of nesting into dot-notation', () => {
    const input = { optimizer: { type: "adam", lr: 0.001 } };
    expect(flattenObject(input)).toEqual({
      "optimizer.type": "adam",
      "optimizer.lr": 0.001,
    });
  });

  it('flattens deeply nested objects', () => {
    const input = { model: { encoder: { layers: { count: 12 } } } };
    expect(flattenObject(input)).toEqual({
      "model.encoder.layers.count": 12,
    });
  });

  // --- Arrays ---

  it('preserves arrays as leaf values', () => {
    // Arrays should NOT be recursed into — they're treated as atomic values
    const input = { tags: ["v1", "production"] };
    expect(flattenObject(input)).toEqual({ tags: ["v1", "production"] });
  });

  it('preserves arrays inside nested objects', () => {
    const input = { model: { hidden_sizes: [256, 128, 64] } };
    expect(flattenObject(input)).toEqual({
      "model.hidden_sizes": [256, 128, 64],
    });
  });

  // --- Prefix parameter ---

  it('prepends prefix to all keys', () => {
    const input = { lr: 0.01 };
    expect(flattenObject(input, "config")).toEqual({ "config.lr": 0.01 });
  });

  // --- Edge cases ---

  it('returns empty object for empty input', () => {
    expect(flattenObject({})).toEqual({});
  });

  it('handles primitive with prefix', () => {
    // During recursion, a primitive value with a prefix gets stored under that key
    expect(flattenObject("hello", "field")).toEqual({ field: "hello" });
  });

  it('handles primitive without prefix', () => {
    // No prefix = no key to store under, so nothing is returned
    expect(flattenObject(42)).toEqual({});
  });

  it('handles null leaf values inside objects', () => {
    const input = { a: null, b: { c: null } };
    expect(flattenObject(input)).toEqual({ a: null, "b.c": null });
  });

  it('handles boolean leaf values', () => {
    const input = { training: { use_amp: true, debug: false } };
    expect(flattenObject(input)).toEqual({
      "training.use_amp": true,
      "training.debug": false,
    });
  });
});
