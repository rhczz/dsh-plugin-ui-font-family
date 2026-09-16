/**
 * The browser's owner of the `@font-face` block for stored fonts.
 *
 * The Host renders the same block into the served page, so a stored font is
 * paintable at first paint. The browser takes that element over because only
 * the browser knows about a font uploaded during this session, and because the
 * rules have to come back out when the plugin unloads.
 * @module dsh-plugin-ui-font-family/client/font-face-style
 */

import { FONT_FACE_STYLE_ID } from '../font-face.ts'

/** The element carrying the declarations, once something has written it. */
export class FontFaceStyle {
  private element: HTMLStyleElement | undefined

  /**
   * Install the declarations for a catalogue.
   * @param css - declarations to install. Empty retracts them, and creates
   * nothing when no element exists yet.
   */
  apply(css: string): void {
    if (css === '' && document.getElementById(FONT_FACE_STYLE_ID) === null) return
    const element = this.ensure()
    if (element.textContent !== css) element.textContent = css
  }

  /** Remove the element carrying this plugin's declarations. */
  dispose(): void {
    this.element?.remove()
    this.element = undefined
  }

  /**
   * @returns the element to write, adopting the Host's one when it exists.
   */
  private ensure(): HTMLStyleElement {
    if (this.element !== undefined) return this.element
    const existing = document.getElementById(FONT_FACE_STYLE_ID)
    const element = existing instanceof HTMLStyleElement ? existing : document.createElement('style')
    if (element !== existing) {
      element.id = FONT_FACE_STYLE_ID
      document.head.append(element)
    }
    this.element = element
    return element
  }
}
