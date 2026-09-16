/**
 * The `ui-font-family` settings section: the persisted font selection both
 * halves read. The Host registers the section and boots the initial stack from
 * it before the shell mounts; the browser renders the row and projects every
 * later change.
 * @module dsh-plugin-ui-font-family/font-settings
 */

import z from '@deepseek-ai/schemastery'
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
 * Schema of `ui-font-family`. Defaults live here so a document that omits the
 * section, or omits one field, still resolves to a usable selection.
 */
export const FontSettingsSchema: z<FontSettings> = z.object({
  [FONT_SOURCE_FIELD]: z.union([...FONT_SOURCES]).default(DEFAULT_FONT_SOURCE),
  [FONT_ID_FIELD]: z.string().default(DEFAULT_FONT_PRESET_ID),
})

/**
 * Reject a resolved section this plugin could not act on: a selection with no
 * name, or a preset id this build does not ship.
 *
 * The settings service reports a rejected section and keeps the last good
 * value, so a hand-edited document cannot leave the plugin holding a dangling
 * selection. The browser re-reads the same judgement through the same service,
 * so the row never offers a state the Host would refuse.
 * @param settings - the resolved section, schema-valid by construction.
 * @throws {TypeError} when the selection names no font this plugin can resolve.
 */
export function validateFontSettings(settings: FontSettings): void {
  if (settings.id === '') {
    throw new TypeError(`${FONT_SETTINGS_NAMESPACE}.${FONT_ID_FIELD} must not be empty`)
  }
  if (settings.source === 'preset' && !isFontPresetId(settings.id)) {
    throw new TypeError(`${FONT_SETTINGS_NAMESPACE}.${FONT_ID_FIELD} names no shipped font preset: "${settings.id}"`)
  }
}
