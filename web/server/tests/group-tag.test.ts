import { describe, it, expect } from 'vitest';
import {
  isGroupTag,
  extractGroupValue,
  dedupGroupTagsKeepLast,
  hasMultipleGroupTags,
  GROUP_TAG_PREFIX,
} from '../lib/group-tag';

describe('group-tag', () => {
  describe('isGroupTag', () => {
    it('detects the group: prefix', () => {
      expect(isGroupTag('group:foo')).toBe(true);
      expect(isGroupTag('group:')).toBe(true); // empty value still has the prefix
      expect(isGroupTag('group')).toBe(false);
      expect(isGroupTag('groupX:foo')).toBe(false);
      expect(isGroupTag('GROUP:foo')).toBe(false); // case-sensitive
      expect(isGroupTag('')).toBe(false);
    });
  });

  describe('extractGroupValue', () => {
    it('returns the value after the colon', () => {
      expect(extractGroupValue(['linear', 'group:sweep-3'])).toBe('sweep-3');
    });
    it('returns null when no group:* tag is present', () => {
      expect(extractGroupValue(['linear', 'production'])).toBeNull();
      expect(extractGroupValue([])).toBeNull();
    });
    it('treats empty group: as no value', () => {
      // `group:` with no body is a malformed tag; we don't surface it as a
      // bucket label since the SQL coalesce would map it to empty string.
      expect(extractGroupValue(['group:'])).toBeNull();
    });
    it('returns the first group:* when multiple exist', () => {
      // Should never happen at the write boundary, but the read helper is
      // forgiving — first wins.
      expect(extractGroupValue(['group:first', 'group:second'])).toBe('first');
    });
  });

  describe('dedupGroupTagsKeepLast', () => {
    it('keeps the LAST group:* tag when multiple are present', () => {
      expect(dedupGroupTagsKeepLast(['group:a', 'foo', 'group:b'])).toEqual([
        'foo',
        'group:b',
      ]);
    });
    it('preserves non-group tag order', () => {
      expect(dedupGroupTagsKeepLast(['a', 'b', 'group:x', 'c'])).toEqual([
        'a',
        'b',
        'group:x',
        'c',
      ]);
    });
    it('keeps the surviving group:* at its original position', () => {
      const result = dedupGroupTagsKeepLast(['a', 'group:foo', 'b', 'c']);
      // No second group:* to strip; the function is a no-op shape-wise.
      expect(result).toEqual(['a', 'group:foo', 'b', 'c']);
    });
    it('returns a copy (does not mutate input)', () => {
      const input = ['group:a', 'group:b'];
      const before = [...input];
      dedupGroupTagsKeepLast(input);
      expect(input).toEqual(before);
    });
    it('handles empty input', () => {
      expect(dedupGroupTagsKeepLast([])).toEqual([]);
    });
    it('handles input with no group:* tags', () => {
      expect(dedupGroupTagsKeepLast(['x', 'y'])).toEqual(['x', 'y']);
    });
  });

  describe('hasMultipleGroupTags', () => {
    it('returns true only when 2+ group:* tags exist', () => {
      expect(hasMultipleGroupTags([])).toBe(false);
      expect(hasMultipleGroupTags(['foo'])).toBe(false);
      expect(hasMultipleGroupTags(['group:a'])).toBe(false);
      expect(hasMultipleGroupTags(['group:a', 'foo'])).toBe(false);
      expect(hasMultipleGroupTags(['group:a', 'group:b'])).toBe(true);
      expect(hasMultipleGroupTags(['group:a', 'foo', 'group:b'])).toBe(true);
    });
  });

  it('GROUP_TAG_PREFIX is the canonical "group:" string', () => {
    expect(GROUP_TAG_PREFIX).toBe('group:');
  });
});
