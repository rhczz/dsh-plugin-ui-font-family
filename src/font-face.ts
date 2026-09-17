/**
 * `@font-face` declarations for the uploaded catalogue. A family in the CSS
 * stack is usable only once the browser has a source for it, so every stored
 * font needs a rule naming its download route. The Host writes the block into
 * the served page and the browser keeps it current, both through
 * {@link fontFaceCss}.
 * @module dsh-plugin-ui-font-family/font-face
 */

import { FONT_COLLECTION_ROUTE } from './font-api.ts'
import { quoteFontFamily } from './font-selection.ts'

/**
 * Id of the element holding the declarations.
 *
 * The Host renders it into the page and the browser adopts that same element
 * rather than adding a second block for families it already declares.
 */
export const FONT_FACE_STYLE_ID = 'dsh-ui-font-family-face'

/**
 * Build the declarations for a catalogue.
 *
 * `font-display: swap` keeps text readable in the fallback while a face loads.
 * No `font-weight` or `font-style` is declared, so one stored face answers every
 * weight and slant instead of handing bold text to a different family.
 * @param uploaded - family name by stored font id.
 * @returns the CSS text, empty when nothing is stored.
 */
export function fontFaceCss(uploaded: ReadonlyMap<string, string>): string {
  const rules: string[] = []
  for (const [id, family] of uploaded) {
    // The id is this Host's own file name, but it arrives over the wire, so it
    // is escaped rather than trusted; the family is quoted for the same reason.
    const url = `${FONT_COLLECTION_ROUTE}/${encodeURIComponent(id)}`
    rules.push(`@font-face{font-family:${quoteFontFamily(family)};src:url("${url}");font-display:swap}`)
  }
  return rules.join('')
}
