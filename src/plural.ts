/**
 * Counted nouns, per language.
 *
 * The two rules genuinely differ, and no single comparison gets both right:
 * English pluralizes everything but one ("0 nodes"), French keeps the singular
 * for zero as well ("0 nœud"). Hence two functions rather than one flag.
 */

/** `1 node` / `0 nodes` / `2 nodes`. */
export function countEn(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** `0 nœud` / `1 nœud` / `2 nœuds`. */
export function countFr(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`
}
