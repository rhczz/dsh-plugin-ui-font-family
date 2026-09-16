// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { FONT_FAMILY_PROPERTY } from '../../src/font-selection.ts'
import { FontPresenter, FONT_LAYER_SOURCE } from '../../src/client/font-presenter.ts'
import { FakeTheme } from './theme-stub.ts'
import { normalizeStack } from '../css-text.ts'

/** Stack the harness declares for itself, in the theme stylesheet. */
const HARNESS_STACK = "-apple-system, 'PingFang SC', sans-serif"

/**
 * Declare the harness stack the way the theme does. A stylesheet rather than an
 * inline style, because the layer is retracted before the read and an inline
 * value would be retracted with it.
 * @param stack - stack to declare; an empty string declares none.
 */
function declareHarnessStack(stack: string): void {
  const style = document.createElement('style')
  style.textContent = stack === '' ? ':root {}' : `:root { ${FONT_FAMILY_PROPERTY}: ${stack} }`
  document.head.appendChild(style)
}

/** @returns the property as the rendered document carries it. */
function installed(): string {
  return normalizeStack(document.body.style.getPropertyValue(FONT_FAMILY_PROPERTY))
}

/**
 * Build a presenter over a fresh theme service.
 * @param stack - harness stack to declare in the stylesheet.
 * @returns the presenter and the theme service it writes through.
 */
function mount(stack: string = HARNESS_STACK): { presenter: FontPresenter; theme: FakeTheme } {
  declareHarnessStack(stack)
  const theme = new FakeTheme()
  return { presenter: new FontPresenter(theme.asService()), theme }
}

afterEach(() => {
  document.body.removeAttribute('style')
  for (const style of document.head.querySelectorAll('style')) style.remove()
})

describe('FontPresenter', () => {
  it('places the chosen families ahead of the harness stack', () => {
    const { presenter } = mount()
    presenter.apply('Georgia')
    expect(installed()).toBe(normalizeStack(`Georgia, ${HARNESS_STACK}`))
    expect(normalizeStack(presenter.current())).toBe(normalizeStack(`Georgia, ${HARNESS_STACK}`))
  })

  it('writes the token through the theme service rather than the document', () => {
    // The theme service is the only writer: it owns retraction of the layers it
    // applied, and one layer per source is what makes a re-apply replace rather
    // than stack. A second writer on the same property would survive teardown.
    const { presenter, theme } = mount()
    presenter.apply('Georgia')
    expect(theme.sources()).toEqual([FONT_LAYER_SOURCE])
    expect(normalizeStack(theme.layerFor(FONT_LAYER_SOURCE)?.[FONT_FAMILY_PROPERTY]?.light ?? ''))
      .toBe(normalizeStack(`Georgia, ${HARNESS_STACK}`))
  })

  it('reports the harness stack a preview appends', () => {
    const { presenter } = mount()
    presenter.apply('Georgia')
    expect(normalizeStack(presenter.harnessStack())).toBe(normalizeStack(HARNESS_STACK))
  })

  it('does not append the harness stack twice', () => {
    // Composing against the value this class installed earlier would grow the
    // stack by one tail per projection.
    const { presenter } = mount()
    presenter.apply('Georgia')
    presenter.apply('Silkscreen')
    presenter.apply('Silkscreen')
    expect(installed()).toBe(normalizeStack(`Silkscreen, ${HARNESS_STACK}`))
  })

  it('installs nothing for a selection that asks for the harness font', () => {
    const { presenter, theme } = mount()
    presenter.apply('Georgia')
    presenter.apply(undefined)
    expect(installed()).toBe('')
    expect(presenter.current()).toBe('')
    expect(theme.sources()).toEqual([])
  })

  it('installs nothing when the document declares no harness stack', () => {
    // Writing the families alone would drop the faces the harness laid its
    // interface out for, so the harness font stands instead.
    const { presenter } = mount('')
    presenter.apply('Georgia')
    expect(installed()).toBe('')
    expect(presenter.current()).toBe('')
  })

  it('retracts its own layer on disposal, revealing the theme stack', () => {
    const { presenter } = mount()
    presenter.apply('Georgia')
    presenter.dispose()
    expect(installed()).toBe('')
  })

  it('retracts the bootstrap row it wrote before the theme service existed', () => {
    // The Host's row runs before any plugin, so the theme service never saw it
    // and would not retract it; leaving it would freeze a font the user can no
    // longer change.
    const { presenter } = mount()
    document.body.style.setProperty(FONT_FAMILY_PROPERTY, `Georgia, ${HARNESS_STACK}`)
    presenter.apply(undefined)
    expect(document.body.style.getPropertyValue(FONT_FAMILY_PROPERTY)).toBe('')
  })

  it('reads the harness stack rather than its own bootstrap composition', () => {
    const { presenter } = mount()
    document.body.style.setProperty(FONT_FAMILY_PROPERTY, `Georgia, ${HARNESS_STACK}`)
    presenter.apply('Silkscreen')
    expect(installed()).toBe(normalizeStack(`Silkscreen, ${HARNESS_STACK}`))
  })

  it('is a no-op when there is nothing to retract', () => {
    const { presenter } = mount()
    const written = document.body.getAttribute('style')
    presenter.dispose()
    expect(document.body.getAttribute('style')).toBe(written)
  })
})
