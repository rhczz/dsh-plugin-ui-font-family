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

  it('retracts the block it owns when nothing is stored any more', () => {
    const faces = new FontFaceStyle()
    faces.apply(CSS)
    faces.apply('')
    expect(element()).toBeNull()
  })

  it('adopts the block the Host rendered instead of adding a second one', () => {
    const rendered = hostRendered('@font-face{font-family:Old;src:url("/fonts/old.ttf")}')
    new FontFaceStyle().apply(CSS)
    expect(document.querySelectorAll(`#${FONT_FACE_STYLE_ID}`)).toHaveLength(1)
    expect(element()).toBe(rendered)
    expect(rendered.textContent).toBe(CSS)
  })

  it('removes a block the Host rendered once nothing is stored', () => {
    // The Host renders the block only while something is stored, so an empty
    // catalogue means the element describes nothing; leaving it in the head
    // would leave a plugin-owned node that no later state accounts for.
    const rendered = hostRendered(CSS)
    new FontFaceStyle().apply('')
    expect(element()).toBeNull()
    expect(rendered.isConnected).toBe(false)
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

  it('leaves an element of another kind carrying the id alone', () => {
    // The id names this plugin's stylesheet. An element of another type wearing
    // it is somebody else's node, and removal is not this plugin's to make.
    const foreign = document.createElement('div')
    foreign.id = FONT_FACE_STYLE_ID
    document.head.append(foreign)
    new FontFaceStyle().dispose()
    expect(foreign.isConnected).toBe(true)
    foreign.remove()
  })
})
