/**
 * The `ui-font-family` settings section: the persisted font selection both
 * halves read, and the rule deciding which family names it may carry. The Host
 * registers the section and boots the initial stack from it before the shell
 * mounts; the browser renders the row and projects every later change.
 *
 * This module imports nothing: the browser half reaches it for these constants,
 * so anything added here is bundled into the page. The schema lives in
 * `font-settings-schema.ts`, which only the Host half loads.
 * @module dsh-plugin-ui-font-family/font-settings
 */

import { DEFAULT_FONT_PRESET_ID, isFontPresetId } from './font-presets.ts'

/** Settings namespace owned by this plugin; lower-case and hyphenated by contract. */
export const FONT_SETTINGS_NAMESPACE = 'ui-font-family'

/** Field naming the catalogue the selected font belongs to. */
export const FONT_SOURCE_FIELD = 'source'

/** Field naming the selected font within its catalogue. */
export const FONT_ID_FIELD = 'id'

/**
 * Catalogues a selection can come from.
 *
 * - `preset` — a stack compiled into this plugin.
 * - `system` — a font installed on the machine running the browser, held by
 *   CSS family name because the Host cannot enumerate the fonts of a browser
 *   running elsewhere.
 * - `upload` — a file in the Host's user font directory, held by its file name.
 */
export const FONT_SOURCES = ['preset', 'system', 'upload'] as const

/** One of {@link FONT_SOURCES}. */
export type FontSource = typeof FONT_SOURCES[number]

/** Catalogue a selection falls back to when nothing else resolves. */
export const DEFAULT_FONT_SOURCE: FontSource = 'preset'

/** Selection applied before any user choice. */
export interface FontSettings {
  /** Catalogue {@link FontSettings.id} indexes. */
  source: FontSource
  /** Preset id for `preset`; CSS family name for `system`; file name for `upload`. */
  id: string
}

/** Selection a profile gets when neither the document nor the composition names one. */
export const DEFAULT_FONT_SETTINGS: FontSettings = Object.freeze({
  source: DEFAULT_FONT_SOURCE,
  id: DEFAULT_FONT_PRESET_ID,
})

/**
 * Characters that end the string, declaration, or script element a family name
 * is written into.
 *
 * A family name reaches two text sinks this plugin builds by hand: a quoted CSS
 * string (`@font-face` and the installed stack) and a JSON string inside the
 * served body script. There, `{`, `}`, and `;` end a declaration, `'` and `"`
 * end the quoted string, `\` escapes whatever follows, `<` opens markup, and
 * `</script` closes the served element. Control characters, including a
 * newline, end a CSS string regardless of quoting.
 */
const UNSAFE_FAMILY_CHARACTERS = '{;}<>\'"\\'

/**
 * Judge one character of a family name. The gate on a stored selection and the
 * cleaner applied to a name table both read this rule, so the two cannot drift
 * apart on what is writable.
 * @param character - one character, read as a code point by the caller.
 * @returns whether a family name carrying it could not be written safely.
 */
export function isUnsafeFamilyNameCharacter(character: string): boolean {
  // The first UTF-16 unit decides this: every code point at or below U+009F is
  // one unit, and a surrogate half of anything above it is never a control.
  const unit = character.charCodeAt(0)
  const control = unit < 0x20 || (unit >= 0x7f && unit <= 0x9f)
  return control || UNSAFE_FAMILY_CHARACTERS.includes(character)
}

/**
 * Judge a family name a settings document asks the plugin to install. A
 * `system` selection is a CSS family name the Host cannot verify, so this rule
 * is what keeps an unsafe name out of both sinks at the write rather than at the
 * next page render.
 * @param name - candidate family name.
 * @returns whether the name may be persisted as a `system` selection.
 */
export function isUsableFontFamilyName(name: string): boolean {
  if (name === '' || name !== name.trim()) return false
  for (const character of name) {
    if (isUnsafeFamilyNameCharacter(character)) return false
  }
  return true
}

/**
 * Reject a resolved section this plugin could not act on: no name, a preset id
 * this build does not ship, or a `system` family name that cannot be written
 * into the stylesheet and the bootstrap row.
 *
 * The settings service reports a rejected section, keeps the last good value,
 * and refuses a write that resolves to one, so neither a hand-edited document
 * nor a client write leaves the plugin holding a selection it would have to
 * sanitize before serving.
 * @param settings - the resolved section, schema-valid by construction.
 * @throws {TypeError} when the selection names no font this plugin can serve.
 */
export function validateFontSettings(settings: FontSettings): void {
  if (settings.id === '') {
    throw new TypeError(`${FONT_SETTINGS_NAMESPACE}.${FONT_ID_FIELD} must not be empty`)
  }
  if (settings.source === 'preset' && !isFontPresetId(settings.id)) {
    throw new TypeError(`${FONT_SETTINGS_NAMESPACE}.${FONT_ID_FIELD} names no shipped font preset: "${settings.id}"`)
  }
  if (settings.source === 'system' && !isUsableFontFamilyName(settings.id)) {
    throw new TypeError(
      `${FONT_SETTINGS_NAMESPACE}.${FONT_ID_FIELD} is not a usable CSS family name: "${settings.id}"`,
    )
  }
}
