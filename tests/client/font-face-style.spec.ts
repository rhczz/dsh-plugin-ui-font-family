// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { FONT_FACE_STYLE_ID } from '../../src/font-face.ts'
import { FontFaceStyle } from '../../src/client/font-face-style.ts'

/** Declarations one case installs. */
const CSS = '@font-face{font-family:Alpha;src:url("/fonts/a.ttf")}'

/** The element as the document currently holds it. */
function element(): HTMLStyleElement | null {
  const found = document.getElementById(FONT_FACE_STYLE_ID)
  return found instanceof HTMLStyleElement ? found : null
}

/**
 * Render the block the way the Host's index row does.
 * @param text - declarations to place in the page.
 * @returns the element the page carries.
 */
function hostRendered(text: string): HTMLStyleElement {
  const style = document.createElement('style')
  style.id = FONT_FACE_STYLE_ID
  style.textContent = text
  document.head.append(style)
  return style
}

afterEach(() => {
  element()?.remove()
})

describe('FontFaceStyle', () => {
  it('creates the element on first use', () => {
    new FontFaceStyle().apply(CSS)
    expect(element()?.textContent).toBe(CSS)
  })

  it('writes nothing when there is nothing to declare', () => {
    new FontFaceStyle().apply('')
    expect(element()).toBeNull()
  })

  it('updates the element it already owns', () => {
    const faces = new FontFaceStyle()
    faces.apply(CSS)
    faces.apply('')
    expect(element()?.textContent).toBe('')
  })

  it('adopts the block the Host rendered instead of adding a second one', () => {
    const rendered = hostRendered('@font-face{font-family:Old;src:url("/fonts/old.ttf")}')
    new FontFaceStyle().apply(CSS)
    expect(document.querySelectorAll(`#${FONT_FACE_STYLE_ID}`)).toHaveLength(1)
    expect(element()).toBe(rendered)
    expect(rendered.textContent).toBe(CSS)
  })

  it('clears a block the Host rendered once nothing is stored', () => {
    const rendered = hostRendered(CSS)
    new FontFaceStyle().apply('')
    expect(rendered.textContent).toBe('')
  })

  it('does not rewrite an unchanged block', () => {
    const faces = new FontFaceStyle()
    faces.apply(CSS)
    const node = element()
    faces.apply(CSS)
    expect(element()).toBe(node)
  })

  it('removes the element on disposal', () => {
    const faces = new FontFaceStyle()
    faces.apply(CSS)
    faces.dispose()
    expect(element()).toBeNull()
  })

  it('re-creates the element after disposal, so a restart installs again', () => {
    const faces = new FontFaceStyle()
    faces.apply(CSS)
    faces.dispose()
    faces.apply(CSS)
    expect(element()?.textContent).toBe(CSS)
  })

  it('is a no-op when there is nothing to remove', () => {
    expect(() => { new FontFaceStyle().dispose() }).not.toThrow()
  })
})
