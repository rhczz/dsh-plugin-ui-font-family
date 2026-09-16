/**
 * Comparison helpers for stacks read back out of a CSS custom property.
 *
 * A browser reports the value it was given, but jsdom's CSS serializer
 * re-quotes family names and drops the space after each comma. Comparing the
 * normalized form keeps these specs about the order and the names a stack
 * carries, which is the behavior under test, rather than about which library
 * serialized it.
 * @module dsh-plugin-ui-font-family/tests/css-text
 */

/**
 * Reduce a family stack to a form two serializers agree on.
 * @param stack - stack as written or as read back.
 * @returns the stack with quotes unified and every space removed.
 */
export function normalizeStack(stack: string): string {
  return stack.replaceAll('"', "'").replaceAll(/\s+/g, '')
}
