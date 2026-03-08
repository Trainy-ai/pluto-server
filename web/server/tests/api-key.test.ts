/**
 * Unit tests for the API key utility functions.
 *
 * These functions handle the full lifecycle of API keys:
 * - Generation (secure with SHA-256 hashing, insecure stored as plaintext)
 * - Storage preparation (hash secure keys, pass insecure keys through)
 * - Lookup preparation (same hashing for search, reject unknown prefixes)
 * - Display masking (hide middle of secure keys, show insecure keys in full)
 */

import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  apiKeyToStore,
  keyToSearchFor,
  createKeyString,
  SECURE_API_KEY_PREFIX,
  INSECURE_API_KEY_PREFIX,
} from '../lib/api-key';

describe('API Key Constants', () => {
  it('secure prefix is "mlps_"', () => {
    expect(SECURE_API_KEY_PREFIX).toBe('mlps_');
  });

  it('insecure prefix is "mlpi_"', () => {
    expect(INSECURE_API_KEY_PREFIX).toBe('mlpi_');
  });
});

describe('generateApiKey', () => {
  it('generates a secure key starting with mlps_', () => {
    const key = generateApiKey(true);
    expect(key.startsWith('mlps_')).toBe(true);
  });

  it('generates an insecure key starting with mlpi_', () => {
    const key = generateApiKey(false);
    expect(key.startsWith('mlpi_')).toBe(true);
  });

  it('secure keys are longer than insecure keys (24 vs 16 random chars)', () => {
    const secure = generateApiKey(true);
    const insecure = generateApiKey(false);
    // secure: "mlps_" (5) + 24 = 29
    // insecure: "mlpi_" (5) + 16 = 21
    expect(secure.length).toBe(29);
    expect(insecure.length).toBe(21);
  });

  it('generates unique keys on each call', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateApiKey(true)));
    expect(keys.size).toBe(20);
  });
});

describe('apiKeyToStore', () => {
  it('hashes secure keys to a 64-char hex string (SHA-256)', async () => {
    const key = 'mlps_abcdefghijklmnopqrstuvwx';
    const stored = await apiKeyToStore(key);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns insecure keys unchanged', async () => {
    const key = 'mlpi_abcdefghijklmnop';
    const stored = await apiKeyToStore(key);
    expect(stored).toBe(key);
  });

  it('produces the same hash for the same secure key', async () => {
    const key = 'mlps_deterministic_test_key!';
    const hash1 = await apiKeyToStore(key);
    const hash2 = await apiKeyToStore(key);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different secure keys', async () => {
    const hash1 = await apiKeyToStore('mlps_aaaaaaaaaaaaaaaaaaaaaaaa');
    const hash2 = await apiKeyToStore('mlps_bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(hash1).not.toBe(hash2);
  });
});

describe('keyToSearchFor', () => {
  it('hashes secure keys (same as apiKeyToStore)', async () => {
    const key = 'mlps_test_secure_key_12345678';
    const searchKey = await keyToSearchFor(key);
    const storeKey = await apiKeyToStore(key);
    expect(searchKey).toBe(storeKey);
  });

  it('returns insecure keys unchanged', async () => {
    const key = 'mlpi_test_insecure_k';
    const searchKey = await keyToSearchFor(key);
    expect(searchKey).toBe(key);
  });

  it('throws for keys with unknown prefix', async () => {
    await expect(keyToSearchFor('unknown_prefix_key')).rejects.toThrow('Invalid API key');
  });

  it('throws for empty string', async () => {
    await expect(keyToSearchFor('')).rejects.toThrow('Invalid API key');
  });

  it('throws for keys that look similar but have wrong prefix', async () => {
    await expect(keyToSearchFor('mlpx_close_but_no_cigar')).rejects.toThrow('Invalid API key');
  });
});

describe('createKeyString', () => {
  it('masks secure keys: shows first 6 chars + stars + last 2 chars', () => {
    // "mlps_abcdefghijklmnopqrstuvwx" (29 chars)
    // first 6: "mlps_a", stars: 29-5-2 = 22, last 2: "wx"
    // result = 6 + 22 + 2 = 30 chars
    const key = 'mlps_abcdefghijklmnopqrstuvwx';
    const masked = createKeyString(key);
    expect(masked.startsWith('mlps_a')).toBe(true);
    expect(masked.endsWith('wx')).toBe(true);
    expect(masked).toContain('*');
    // Verify structure: first 6 visible + stars + last 2 visible
    const numStars = key.length - 5 - 2; // per implementation
    expect(masked).toBe('mlps_a' + '*'.repeat(numStars) + 'wx');
  });

  it('returns insecure keys in full (no masking)', () => {
    const key = 'mlpi_visible_key_here';
    const result = createKeyString(key);
    expect(result).toBe(key);
  });

  it('masked key has correct star count', () => {
    const key = 'mlps_abcdefghijklmnopqrstuvwx'; // 29 chars
    const masked = createKeyString(key);
    const starCount = (masked.match(/\*/g) || []).length;
    // numStars = length - 5 (prefix) - 2 (suffix shown) = 29 - 5 - 2 = 22
    expect(starCount).toBe(22);
  });
});
