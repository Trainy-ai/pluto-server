/**
 * Unit tests for SQID encode/decode utilities.
 *
 * SQIDs are used throughout the API to convert numeric database IDs (bigint)
 * into short, URL-friendly strings. This is the public-facing ID format
 * for runs, projects, etc. The encoding must be deterministic and reversible.
 */

import { describe, it, expect } from 'vitest';
import { sqidEncode, sqidDecode } from '../lib/sqid';

describe('sqidEncode', () => {
  it('encodes a small number to a string of at least 5 characters', () => {
    const encoded = sqidEncode(1);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThanOrEqual(5);
  });

  it('encodes zero', () => {
    const encoded = sqidEncode(0);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThanOrEqual(5);
  });

  it('produces only alphanumeric characters', () => {
    const encoded = sqidEncode(12345);
    expect(encoded).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('accepts bigint input', () => {
    const encoded = sqidEncode(BigInt(42));
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThanOrEqual(5);
  });

  it('produces different strings for different IDs', () => {
    const a = sqidEncode(1);
    const b = sqidEncode(2);
    const c = sqidEncode(100);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('is deterministic (same input always produces same output)', () => {
    expect(sqidEncode(42)).toBe(sqidEncode(42));
    expect(sqidEncode(999)).toBe(sqidEncode(999));
  });
});

describe('sqidDecode', () => {
  it('reverses encoding for small numbers', () => {
    expect(sqidDecode(sqidEncode(1))).toBe(1);
    expect(sqidDecode(sqidEncode(0))).toBe(0);
    expect(sqidDecode(sqidEncode(42))).toBe(42);
  });

  it('reverses encoding for large numbers', () => {
    expect(sqidDecode(sqidEncode(1000000))).toBe(1000000);
    expect(sqidDecode(sqidEncode(9999999))).toBe(9999999);
  });

  it('reverses encoding for bigint input', () => {
    // BigInt gets converted to Number internally
    expect(sqidDecode(sqidEncode(BigInt(123)))).toBe(123);
  });

  it('returns undefined for unrecognized strings', () => {
    // sqids library returns undefined when decoding fails (empty array[0])
    const result = sqidDecode('!!!!!');
    expect(result).toBeUndefined();
  });
});

describe('sqidEncode + sqidDecode roundtrip', () => {
  const testIds = [0, 1, 2, 10, 100, 1000, 12345, 99999, 1000000];

  for (const id of testIds) {
    it(`roundtrips ID ${id}`, () => {
      expect(sqidDecode(sqidEncode(id))).toBe(id);
    });
  }
});
