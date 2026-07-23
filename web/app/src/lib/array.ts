export function intersection<T>(a: T[], b: T[]): T[] {
  return a.filter((x) => b.includes(x))
}

export function uniq<T>(a: T[]): T[] {
  return Array.from(new Set(a))
}

/** Move the item at `from` to `to` within a copy of `list`. */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list
  }
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Move `fromKey` so it sits immediately before/after `targetKey` in a copy of
 * `list`. Returns the input by reference when the move is a no-op (unknown
 * keys, self-drop, or already in place).
 */
export function moveRelative(
  list: string[],
  fromKey: string,
  targetKey: string,
  position: "before" | "after",
): string[] {
  if (fromKey === targetKey) {
    return list
  }
  const from = list.indexOf(fromKey)
  const target = list.indexOf(targetKey)
  if (from === -1 || target === -1) {
    return list
  }
  let to = position === "after" ? target + 1 : target
  if (from < to) {
    to -= 1
  }
  if (from === to) {
    return list
  }
  return reorder(list, from, to)
}
