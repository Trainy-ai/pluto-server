/** Shared helpers for the W&B-style `group:<value>` tag convention.
 *  A run may carry at most one `group:*` tag — it encodes the run's
 *  membership in a named experiment group, like W&B's `group` field. */

export const GROUP_TAG_PREFIX = "group:";

export function isGroupTag(tag: string): boolean {
  return tag.startsWith(GROUP_TAG_PREFIX);
}

/** Return the group name encoded in the first `group:*` tag, or null
 *  if no such tag exists. Empty value (`"group:"`) is treated as null. */
export function extractGroupValue(tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (isGroupTag(tag)) {
      const value = tag.slice(GROUP_TAG_PREFIX.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** Return a copy of `tags` with all but the last `group:*` tag removed.
 *  Order of non-group tags is preserved; the surviving `group:*` keeps
 *  its original position (the last occurrence). Used at create time to
 *  let W&B-derived group:* tags win over any stale ones the caller
 *  might have included. */
export function dedupGroupTagsKeepLast(tags: readonly string[]): string[] {
  let lastIdx = -1;
  for (let i = tags.length - 1; i >= 0; i--) {
    if (isGroupTag(tags[i])) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) return [...tags];
  return tags.filter((t, i) => !isGroupTag(t) || i === lastIdx);
}

/** True iff `tags` contains more than one `group:*` tag.
 *  Used at update-tags boundaries to reject ambiguous client payloads
 *  (the picker UI should resolve the conflict before submitting). */
export function hasMultipleGroupTags(tags: readonly string[]): boolean {
  let count = 0;
  for (const tag of tags) {
    if (isGroupTag(tag)) {
      count++;
      if (count > 1) return true;
    }
  }
  return false;
}
