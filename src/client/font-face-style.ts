/**
 * The browser's owner of the `@font-face` block for stored fonts. The Host
 * renders the same block into the served page; the browser takes that element
 * over, because only the browser knows about a font uploaded during this session
 * and the rules have to come out when the plugin unloads.
 * @module dsh-plugin-ui-font-family/client/font-face-style
 */

import { FONT_FACE_STYLE_ID } from '../font-face.ts'

/** The element carrying the declarations, once something has written it. */
export class FontFaceStyle {
  private element: HTMLStyleElement | undefined

  /**
   * Install the declarations for a catalogue. Empty declarations retract the
   * element rather than emptying it: with nothing stored there is nothing to
   * declare, and a later upload creates the element again.
   * @param css - declarations to install. Empty removes them.
   */
  apply(css: string): void {
    if (css === '') {
      this.dispose()
      return
    }
    const element = this.ensure()
    if (element.textContent !== css) element.textContent = css
  }

  /**
   * Remove the element carrying this plugin's declarations. The Host renders the
   * block into the served page, so an element this instance never adopted is
   * still this plugin's to remove; {@link ensure} names the id and type it has.
   */
  dispose(): void {
    this.element?.remove()
    this.element = undefined
    const rendered = document.getElementById(FONT_FACE_STYLE_ID)
    if (rendered instanceof HTMLStyleElement) rendered.remove()
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
