// @vitest-environment jsdom
import { runInThisContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { bootFontInjection } from '../src/boot-font.ts'
import { FONT_FAMILY_PROPERTY } from '../src/font-selection.ts'
import { normalizeStack } from './css-text.ts'

/** Stack a harness build declares for itself, in the theme stylesheet. */
const HARNESS_STACK = "-apple-system, 'PingFang SC', sans-serif"

/**
 * Declare a harness stack the way the theme does, from a stylesheet rather than
 * an inline style, because the script retracts the inline property before it
 * reads and an inline value would be retracted with it.
 * @param stack - stack to declare; an empty string declares none.
 */
function declareHarnessStack(stack: string): void {
  const style = document.createElement('style')
  style.textContent = stack === '' ? ':root {}' : `:root { ${FONT_FAMILY_PROPERTY}: ${stack} }`
  document.head.appendChild(style)
}

/** Run one generated row the way the browser runs it. */
function run(families: string): void {
  runInThisContext(bootFontInjection(families).text)
}

/** @returns the property as the rendered document carries it. */
function installed(): string {
  return normalizeStack(document.body.style.getPropertyValue(FONT_FAMILY_PROPERTY))
}

afterEach(() => {
  document.body.removeAttribute('style')
  for (const style of document.head.querySelectorAll('style')) style.remove()
})

describe('the font bootstrap row', () => {
  it('is a body script, so it runs before the shell mounts', () => {
    const injection = bootFontInjection('Georgia')
    expect(injection.kind).toBe('script')
    expect(injection.placement).toBe('body')
  })

  it('places the resolved families ahead of the stack the harness declares', () => {
    declareHarnessStack(HARNESS_STACK)
    // The row's text is the shipped artifact: running it is the only check that
    // says the script installs what the resolver produced.
    run('Silkscreen, Georgia')
    expect(installed()).toBe(normalizeStack(`Silkscreen, Georgia, ${HARNESS_STACK}`))
  })

  it('keeps the harness stack as the tail rather than restating one', () => {
    declareHarnessStack(HARNESS_STACK)
    run('Georgia')
    expect(installed().endsWith(normalizeStack(HARNESS_STACK))).toBe(true)
  })

  it('composes against the harness stack, not against its own previous write', () => {
    // Re-running the row must not append one more tail each time; the script
    // retracts its own write before reading for exactly this reason.
    declareHarnessStack(HARNESS_STACK)
    run('Georgia')
    run('Georgia')
    expect(installed()).toBe(normalizeStack(`Georgia, ${HARNESS_STACK}`))
  })

  it('writes where the theme presenter writes, so one element owns the token', () => {
    // The client takes this row over by writing the same property on the same
    // element; a row on the root would survive the presenter's retraction.
    declareHarnessStack(HARNESS_STACK)
    run('Georgia')
    expect(document.documentElement.style.getPropertyValue(FONT_FAMILY_PROPERTY)).toBe('')
    expect(document.body.style.getPropertyValue(FONT_FAMILY_PROPERTY)).not.toBe('')
  })

  it('installs nothing when the document declares no harness stack', () => {
    // A stack naming only the chosen family would drop the faces the harness
    // laid its interface out for, so the harness font stays instead.
    declareHarnessStack('')
    run('Georgia')
    expect(installed()).toBe('')
  })

  it('survives a family name carrying quotes', () => {
    declareHarnessStack(HARNESS_STACK)
    run("'O\\'Brien Sans'")
    expect(installed()).toBe(normalizeStack(`'O\\'Brien Sans', ${HARNESS_STACK}`))
  })

  it('names the same property the browser half projects', () => {
    expect(bootFontInjection('x').text).toContain(JSON.stringify(FONT_FAMILY_PROPERTY))
  })
})
