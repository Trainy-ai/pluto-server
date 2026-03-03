export function intersection<T>(a: T[], b: T[]): T[] {
  return a.filter((x) => b.includes(x))
}

export function uniq<T>(a: T[]): T[] {
  return Array.from(new Set(a))
}
