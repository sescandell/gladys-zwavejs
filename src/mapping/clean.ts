/**
 * Normalize a Z-Wave name into an external-id segment and a lookup key:
 * lowercase, spaces to underscores, parentheses dropped.
 *
 * `Door state (simple)` -> `door_state_simple`, `Electric_W_Consumed` ->
 * `electric_w_consumed`.
 *
 * Its output ends up inside external ids, which are persisted: changing this
 * renames every feature of every installed device.
 */
export function clean(text: unknown): string {
  if (!text || typeof text !== 'string') {
    return ''
  }
  return text.replaceAll(' ', '_').replaceAll('(', '').replaceAll(')', '').toLowerCase()
}
