import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_SETTINGS,
  FONT_ID_FIELD,
  FONT_SETTINGS_NAMESPACE,
  FONT_SOURCE_FIELD,
  FONT_SOURCES,
  FontSettingsSchema,
  validateFontSettings,
  type FontSettings,
} from '../src/font-settings.ts'

/**
 * Resolve one settings section the way the settings service does.
 * @param section - raw fields as a settings document would hold them, which is
 * what the schema exists to narrow; callers here deliberately hand it partial
 * and ill-typed documents.
 * @returns the resolved selection.
 */
function resolve(section: Record<string, unknown>): FontSettings {
  return FontSettingsSchema(section as unknown as FontSettings)
}

describe('font settings schema', () => {
  it('resolves an absent section to the default selection', () => {
    expect(resolve({})).toEqual(DEFAULT_FONT_SETTINGS)
  })

  it('fills only the field a document omitted', () => {
    expect(resolve({ [FONT_SOURCE_FIELD]: 'system' }))
      .toEqual({ source: 'system', id: DEFAULT_FONT_SETTINGS.id })
    expect(resolve({ [FONT_ID_FIELD]: 'Georgia' }))
      .toEqual({ source: DEFAULT_FONT_SETTINGS.source, id: 'Georgia' })
  })

  it('accepts every declared catalogue', () => {
    for (const source of FONT_SOURCES) {
      expect(resolve({ [FONT_SOURCE_FIELD]: source, [FONT_ID_FIELD]: 'x' }).source).toBe(source)
    }
  })

  it('rejects a catalogue the plugin does not implement', () => {
    expect(() => resolve({ [FONT_SOURCE_FIELD]: 'network' })).toThrow()
  })

  it('rejects a non-string font id', () => {
    expect(() => resolve({ [FONT_ID_FIELD]: 7 })).toThrow()
  })

  it('owns the namespace the Host registers and the browser binds', () => {
    expect(FONT_SETTINGS_NAMESPACE).toBe('ui-font-family')
  })
})

describe('validateFontSettings', () => {
  it('accepts a shipped preset', () => {
    expect(() => { validateFontSettings({ source: 'preset', id: 'serif' }) }).not.toThrow()
  })

  it('accepts a system family name, including one this machine lacks', () => {
    // A family name travels between machines: the same document is valid on a
    // host that has the font and on one that does not.
    expect(() => { validateFontSettings({ source: 'system', id: 'Georgia' }) }).not.toThrow()
    expect(() => { validateFontSettings({ source: 'system', id: 'No Such Face' }) }).not.toThrow()
  })

  it('accepts an uploaded font id without reading the directory', () => {
    expect(() => { validateFontSettings({ source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' }) }).not.toThrow()
  })

  it('rejects a preset id this build does not ship', () => {
    expect(() => { validateFontSettings({ source: 'preset', id: 'comic' }) })
      .toThrow(/names no shipped font preset/)
  })

  it('rejects a selection that names no font at all', () => {
    expect(() => { validateFontSettings({ source: 'system', id: '' }) }).toThrow(/must not be empty/)
    expect(() => { validateFontSettings({ source: 'upload', id: '' }) }).toThrow(/must not be empty/)
  })

  it('names the offending namespace and field in the failure', () => {
    const settings: FontSettings = { source: 'preset', id: 'comic' }
    expect(() => { validateFontSettings(settings) })
      .toThrow(new RegExp(`${FONT_SETTINGS_NAMESPACE}\\.${FONT_ID_FIELD}`))
  })
})
