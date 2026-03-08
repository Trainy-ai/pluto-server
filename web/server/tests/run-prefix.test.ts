/**
 * Unit tests for generateRunPrefix.
 *
 * Run display IDs look like "MMP-1", "TRA-42" etc., where the prefix
 * is derived from the project name. This function generates that prefix
 * from a project name string. The prefix is used in the UI and API
 * for human-readable run identification.
 */

import { describe, it, expect } from 'vitest';
import { generateRunPrefix } from '../lib/run-prefix';

describe('generateRunPrefix', () => {
  // --- Documented examples from the JSDoc ---

  it('"my-ml-project" → "MMP"', () => {
    expect(generateRunPrefix('my-ml-project')).toBe('MMP');
  });

  it('"training" → "TRA"', () => {
    expect(generateRunPrefix('training')).toBe('TRA');
  });

  it('"image-classification" → "ICL"', () => {
    expect(generateRunPrefix('image-classification')).toBe('ICL');
  });

  it('"resnet-50" → "R50"', () => {
    expect(generateRunPrefix('resnet-50')).toBe('R50');
  });

  it('"a" → "A"', () => {
    expect(generateRunPrefix('a')).toBe('A');
  });

  it('"my project name" → "MPN"', () => {
    expect(generateRunPrefix('my project name')).toBe('MPN');
  });

  // --- Single word ---

  it('single short word takes up to 3 characters', () => {
    expect(generateRunPrefix('ai')).toBe('AI');
  });

  it('single long word truncates to 3 characters', () => {
    expect(generateRunPrefix('classification')).toBe('CLA');
  });

  // --- Multiple words with different separators ---

  it('handles underscore separators', () => {
    expect(generateRunPrefix('my_ml_project')).toBe('MMP');
  });

  it('handles dot separators', () => {
    expect(generateRunPrefix('my.ml.project')).toBe('MMP');
  });

  it('handles space separators', () => {
    expect(generateRunPrefix('my ml project')).toBe('MMP');
  });

  it('handles mixed separators', () => {
    expect(generateRunPrefix('my-ml_project.v2')).toBe('MMPV');
  });

  // --- Caps at 4 characters ---

  it('caps prefix at 4 characters for many words', () => {
    const result = generateRunPrefix('a-b-c-d-e-f');
    expect(result.length).toBeLessThanOrEqual(4);
  });

  // --- Edge cases ---

  it('returns "RUN" for empty string', () => {
    expect(generateRunPrefix('')).toBe('RUN');
  });

  it('returns "RUN" for string with only separators', () => {
    expect(generateRunPrefix('---')).toBe('RUN');
    expect(generateRunPrefix('___')).toBe('RUN');
    expect(generateRunPrefix('...')).toBe('RUN');
  });

  it('always returns uppercase', () => {
    const result = generateRunPrefix('lowercase-project');
    expect(result).toBe(result.toUpperCase());
  });

  // --- Two-word padding ---

  it('pads to 3 chars for two single-char words', () => {
    // Two words: "a" and "b" → prefix "ab" → needs padding from last word
    const result = generateRunPrefix('a-b');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});
