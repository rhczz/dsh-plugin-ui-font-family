import { describe, expect, it } from 'vitest'
import { FONT_COLLECTION_ROUTE } from '../src/font-api.ts'
import { FONT_FACE_STYLE_ID, fontFaceCss } from '../src/font-face.ts'

/**
 * Build the catalogue map the way the Host holds it.
 * @param entries - stored font id and family pairs.
 * @returns the map.
 */
function catalogue(...entries: readonly (readonly [string, string])[]): ReadonlyMap<string, string> {
  return new Map(entries)
}

describe('fontFaceCss', () => {
  it('declares nothing when nothing is stored', () => {
    expect(fontFaceCss(catalogue())).toBe('')
  })

  it('points a family at the route that serves its file', () => {
    expect(fontFaceCss(catalogue(['silkscreen-1a2b3c4d.ttf', 'Silkscreen'])))
      .toBe(`@font-face{font-family:Silkscreen;src:url("${FONT_COLLECTION_ROUTE}/silkscreen-1a2b3c4d.ttf");font-display:swap}`)
  })

  it('quotes a family whose name is not a bare identifier', () => {
    expect(fontFaceCss(catalogue(['a.ttf', 'Brioso Pro']))).toContain("font-family:'Brioso Pro'")
  })

  it('declares one rule per stored font, in catalogue order', () => {
    const css = fontFaceCss(catalogue(['a.ttf', 'Alpha'], ['b.ttf', 'Beta']))
    expect(css.match(/@font-face\{/g)).toHaveLength(2)
    expect(css.indexOf('Alpha')).toBeLessThan(css.indexOf('Beta'))
  })

  it('swaps rather than hiding text while a face loads', () => {
    expect(fontFaceCss(catalogue(['a.ttf', 'Alpha']))).toContain('font-display:swap')
  })

  it('escapes an id that would otherwise end the URL', () => {
    // The id is this Host's own file name, but it arrives over the wire, so a
    // quote or a bracket in it must not reach the stylesheet as syntax.
    const css = fontFaceCss(catalogue(['a".ttf', 'Alpha'], ['b).ttf', 'Beta']))
    expect(css).toContain(`url("${FONT_COLLECTION_ROUTE}/a%22.ttf")`)
    expect(css).toContain(`url("${FONT_COLLECTION_ROUTE}/b).ttf")`)
    expect(css.match(/@font-face\{/g)).toHaveLength(2)
  })

  it('escapes a quote in a family name instead of ending the declaration', () => {
    expect(fontFaceCss(catalogue(['a.ttf', "O'Brien Sans"]))).toContain("font-family:'O\\'Brien Sans'")
  })

  it('names the element the browser adopts', () => {
    expect(FONT_FACE_STYLE_ID).toBe('dsh-ui-font-family-face')
  })
})
