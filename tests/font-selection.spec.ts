import { describe, expect, it } from 'vitest'
import { fontPresetFamilies } from '../src/font-presets.ts'
import type { FontSettings } from '../src/font-settings.ts'
import {
  composeFontStack,
  FONT_FAMILY_PROPERTY,
  isFontSelectionAvailable,
  quoteFontFamily,
  resolveFontProjection,
  UNREAD_FONT_CATALOGUES,
  type FontCatalogues,
  type FontProjection,
} from '../src/font-selection.ts'

/** Uploaded catalogue naming one stored file. */
const WITH_UPLOAD: FontCatalogues = { uploaded: new Map([['silkscreen-1a2b3c4d.ttf', 'Silkscreen']]) }

/** Uploaded catalogue that has been read and does not hold the selection. */
const EMPTY_UPLOAD: FontCatalogues = { uploaded: new Map() }

/** Stack a harness build declares for itself; the tail of every installed one. */
const HARNESS_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"

describe('quoteFontFamily', () => {
  it('leaves a bare identifier unquoted', () => {
    expect(quoteFontFamily('Georgia')).toBe('Georgia')
    expect(quoteFontFamily('Times-New_Roman2')).toBe('Times-New_Roman2')
  })

  it('quotes a name with spaces or punctuation', () => {
    expect(quoteFontFamily('PingFang SC')).toBe("'PingFang SC'")
    expect(quoteFontFamily('Noto Sans CJK SC')).toBe("'Noto Sans CJK SC'")
  })

  it('escapes a quote inside the name instead of ending the string early', () => {
    expect(quoteFontFamily("O'Brien Sans")).toBe("'O\\'Brien Sans'")
  })

  it('escapes a backslash instead of letting it escape the closing quote', () => {
    // `'Evil\'` is an unterminated string: the backslash takes the quote meant
    // to close it, and the declarations after it go with it.
    expect(quoteFontFamily('Evil\\')).toBe("'Evil\\\\'")
  })
})

describe('composeFontStack', () => {
  it('places the chosen families ahead of the harness stack', () => {
    expect(composeFontStack('Georgia', HARNESS_STACK)).toBe(`Georgia, ${HARNESS_STACK}`)
  })

  it('ends in the harness stack, so the harness still draws what the choice cannot', () => {
    expect(composeFontStack('Georgia', HARNESS_STACK)?.endsWith(HARNESS_STACK)).toBe(true)
  })

  it('installs nothing when the selection named no family', () => {
    // The default preset installs nothing: the harness's own stack is already
    // the font its layout was measured for, and any stack written here would
    // replace it with a different one.
    expect(composeFontStack('', HARNESS_STACK)).toBeUndefined()
  })

  it('installs nothing when the harness stack could not be read', () => {
    // Composing without a tail would install a stack that names only the chosen
    // family, which is the failure this plugin exists to avoid.
    expect(composeFontStack('Georgia', '')).toBeUndefined()
  })

  it('does not restate or reorder the harness stack it was given', () => {
    const composed = composeFontStack(fontPresetFamilies('serif'), HARNESS_STACK)
    expect(composed?.slice(composed.length - HARNESS_STACK.length)).toBe(HARNESS_STACK)
  })
})

describe('resolveFontProjection', () => {
  const cases: readonly { name: string; settings: FontSettings; catalogues: FontCatalogues; expect: FontProjection }[] = [
    {
      name: 'a shipped preset resolves to its own families',
      settings: { source: 'preset', id: 'mono' },
      catalogues: UNREAD_FONT_CATALOGUES,
      expect: { kind: 'families', families: fontPresetFamilies('mono') },
    },
    {
      name: 'the default preset resolves to the harness font',
      settings: { source: 'preset', id: 'default' },
      catalogues: UNREAD_FONT_CATALOGUES,
      expect: { kind: 'harness' },
    },
    {
      name: 'a preset id this build does not ship resolves to the harness font',
      settings: { source: 'preset', id: 'comic' },
      catalogues: UNREAD_FONT_CATALOGUES,
      expect: { kind: 'harness' },
    },
    {
      name: 'a system family resolves to itself',
      settings: { source: 'system', id: 'Georgia' },
      catalogues: UNREAD_FONT_CATALOGUES,
      expect: { kind: 'families', families: 'Georgia' },
    },
    {
      name: 'a system family needing quotes is quoted',
      settings: { source: 'system', id: 'Times New Roman' },
      catalogues: UNREAD_FONT_CATALOGUES,
      expect: { kind: 'families', families: "'Times New Roman'" },
    },
    {
      name: 'an empty name is treated as no selection',
      settings: { source: 'system', id: '' },
      catalogues: UNREAD_FONT_CATALOGUES,
      expect: { kind: 'harness' },
    },
    {
      name: 'an uploaded font resolves through the catalogue family',
      settings: { source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' },
      catalogues: WITH_UPLOAD,
      expect: { kind: 'families', families: 'Silkscreen' },
    },
    {
      name: 'an unread catalogue leaves the projection alone',
      settings: { source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' },
      catalogues: UNREAD_FONT_CATALOGUES,
      expect: { kind: 'unresolved' },
    },
    {
      name: 'a deleted upload resolves to the harness font',
      settings: { source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' },
      catalogues: EMPTY_UPLOAD,
      expect: { kind: 'harness' },
    },
  ]

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(resolveFontProjection(testCase.settings, testCase.catalogues)).toEqual(testCase.expect)
    })
  }

  it('never throws for a source outside the declared catalogues', () => {
    // The settings service admits only FONT_SOURCES, so this arm is reachable
    // only if the schema and this switch drift apart. It must still render.
    const drifted = { source: 'network', id: 'x' } as unknown as FontSettings
    expect(resolveFontProjection(drifted, UNREAD_FONT_CATALOGUES)).toEqual({ kind: 'harness' })
  })

  it('resolves a preset without consulting the catalogues', () => {
    expect(resolveFontProjection({ source: 'preset', id: 'sans' }, UNREAD_FONT_CATALOGUES))
      .toEqual(resolveFontProjection({ source: 'preset', id: 'sans' }, WITH_UPLOAD))
  })

  it('asks for no stack for any selection that names no font of its own', () => {
    const none: readonly FontSettings[] = [
      { source: 'preset', id: 'default' },
      { source: 'preset', id: 'nope' },
      { source: 'system', id: '' },
      { source: 'upload', id: 'gone.ttf' },
    ]
    for (const settings of none) {
      expect(resolveFontProjection(settings, EMPTY_UPLOAD)).toEqual({ kind: 'harness' })
    }
  })
})

describe('isFontSelectionAvailable', () => {
  it('reports a shipped preset as available', () => {
    expect(isFontSelectionAvailable({ source: 'preset', id: 'serif' }, UNREAD_FONT_CATALOGUES)).toBe(true)
  })

  it('reports an id this build does not ship as unavailable', () => {
    expect(isFontSelectionAvailable({ source: 'preset', id: 'comic' }, UNREAD_FONT_CATALOGUES)).toBe(false)
  })

  it('reports a system family as available wherever the browser might find it', () => {
    expect(isFontSelectionAvailable({ source: 'system', id: 'Georgia' }, UNREAD_FONT_CATALOGUES)).toBe(true)
    expect(isFontSelectionAvailable({ source: 'system', id: '' }, UNREAD_FONT_CATALOGUES)).toBe(false)
  })

  it('waits for the catalogue before calling an upload missing', () => {
    const selection: FontSettings = { source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' }
    expect(isFontSelectionAvailable(selection, UNREAD_FONT_CATALOGUES)).toBe(true)
    expect(isFontSelectionAvailable(selection, WITH_UPLOAD)).toBe(true)
    expect(isFontSelectionAvailable(selection, EMPTY_UPLOAD)).toBe(false)
  })

  it('calls a source it does not know unavailable', () => {
    // The selection crosses two files this build does not own — settings.yaml
    // and the Host's answer — so a source outside the union is a value that
    // can arrive, and the row has to fall back rather than render a stack it
    // cannot justify.
    const foreign = { source: 'sepia', id: 'old-paper' } as unknown as FontSettings
    expect(isFontSelectionAvailable(foreign, WITH_UPLOAD)).toBe(false)
  })
})

describe('the projected property name', () => {
  it('is the one the shell body rule reads', () => {
    expect(FONT_FAMILY_PROPERTY).toBe('--dsw-font-family')
  })
})
