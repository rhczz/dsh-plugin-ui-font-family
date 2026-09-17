/**
 * Schema of the `ui-font-family` settings section.
 *
 * It lives apart from `font-settings.ts` because it is the only part of the
 * section that needs schemastery, and the browser half imports that module for
 * its constants: a schema the browser never resolves would otherwise be
 * bundled into the page along with the whole library.
 * @module dsh-plugin-ui-font-family/font-settings-schema
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_FONT_SOURCE,
  FONT_ID_FIELD,
  FONT_SOURCE_FIELD,
  FONT_SOURCES,
  type FontSettings,
} from './font-settings.ts'
import { DEFAULT_FONT_PRESET_ID } from './font-presets.ts'

/**
 * Schema of `ui-font-family`. Defaults live here so a document that omits the
 * section, or omits one field, still resolves to a usable selection.
 */
export const FontSettingsSchema: z<FontSettings> = z.object({
  [FONT_SOURCE_FIELD]: z.union([...FONT_SOURCES]).default(DEFAULT_FONT_SOURCE),
  [FONT_ID_FIELD]: z.string().default(DEFAULT_FONT_PRESET_ID),
})
