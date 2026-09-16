/**
 * The fonts this plugin offers. Both halves import them, so a preset id
 * persisted by the browser always resolves to the same families on the Host.
 * @module dsh-plugin-ui-font-family/font-presets
 */

/** Preset ids in presentation order. Every id needs families in {@link FONT_PRESET_FAMILIES}. */
export const FONT_PRESET_IDS = ['default', 'sans', 'serif', 'mono'] as const

/** One of the stacks this plugin ships. */
export type FontPresetId = typeof FONT_PRESET_IDS[number]

/** Preset applied when a selection names nothing usable. */
export const DEFAULT_FONT_PRESET_ID: FontPresetId = 'default'

/**
 * Families each preset names, in CSS `font-family` syntax, with no tail.
 *
 * A preset names only what it changes. The stack the harness itself defines is
 * appended when a stack is installed, and it supplies every family this list
 * does not: the platform's own Latin and Chinese faces, and whatever the
 * harness picks in a future release. So a preset never has to restate the
 * harness's choices, and cannot fall behind them.
 *
 * Two rules shape the lists.
 *
 * Latin families precede Chinese ones, the order the harness's own stack uses.
 * A family that has no Chinese glyph falls through to the next name, so Latin
 * text keeps the chosen face and Chinese text reaches the Chinese face behind
 * it. The reverse order puts a Chinese face in front of every Latin one, and
 * because the platform's Chinese faces are always installed their Latin
 * glyphs would take over the whole interface, at metrics the harness's layout
 * was not measured for.
 *
 * No generic family. `serif`, `monospace` and `sans-serif` resolve against the
 * installed faces and the browser ignores every family written after one, so a
 * generic here would discard the harness stack rather than extend it.
 *
 * `default` names nothing, which is what makes it the harness's own font: a
 * stack installed for it could only replace that font with a different one.
 */
const FONT_PRESET_FAMILIES: Readonly<Record<FontPresetId, string>> = {
  default: '',
  sans: "'Inter', 'Helvetica Neue', Arial",
  serif: "Georgia, 'Times New Roman', Times, 'Songti SC', SimSun, 'Noto Serif CJK SC'",
  mono: "'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, Menlo, 'Sarasa Mono SC', 'Noto Sans Mono CJK SC'",
}

/**
 * Read the families one preset names.
 * @param id - preset to read.
 * @returns the families, ready to be placed ahead of the harness's stack, or
 * the empty string for the preset that names none.
 */
export function fontPresetFamilies(id: FontPresetId): string {
  return FONT_PRESET_FAMILIES[id]
}

/**
 * Test a value read from the settings document for naming a preset this build
 * ships.
 * @param value - candidate preset id.
 * @returns whether `value` is a known preset id.
 */
export function isFontPresetId(value: string): value is FontPresetId {
  return FONT_PRESET_IDS.some(id => id === value)
}
