/**
 * Host bootstrap row for the browser's pre-plugin interval.
 *
 * The script writes the property on `body` that the theme presenter writes
 * later, so the browser half takes the value over rather than unwinding a
 * different one. The harness stack is read back from the document, never
 * restated here. The read retracts this row's own write first, so a re-run
 * composes against the theme rather than against its own composition.
 * @module dsh-plugin-ui-font-family/boot-font
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { FONT_FAMILY_PROPERTY } from './font-selection.ts'

/** The index row kind this plugin contributes. */
type FontIndexInjection = Extract<IndexInjection, { kind: 'script' }>

/**
 * Write one string as a JavaScript string literal that cannot close the script
 * element carrying it. `JSON.stringify` escapes quotes and control characters
 * but leaves `<` alone, and `</script` inside an inline script ends the element
 * wherever it appears. A family name reaches this row from the settings
 * document, so the escape keeps the row a script.
 * @param value - text to embed.
 * @returns the literal, with every `<` written as an escape.
 */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

/**
 * Build the row that places `families` ahead of the harness's own stack.
 * Installs nothing when the document declares no stack of its own: a stack
 * naming only the chosen families would drop the faces the layout was measured
 * for.
 * @param families - resolved families, already quoted and sanitized.
 * @returns the row to inject.
 */
export function bootFontInjection(families: string): FontIndexInjection {
  return {
    kind: 'script',
    placement: 'body',
    text: `(() => {
  const body = document.body
  body.style.removeProperty(${scriptLiteral(FONT_FAMILY_PROPERTY)})
  const base = getComputedStyle(body).getPropertyValue(${scriptLiteral(FONT_FAMILY_PROPERTY)}).trim()
  if (base !== '') body.style.setProperty(${scriptLiteral(FONT_FAMILY_PROPERTY)}, ${scriptLiteral(`${families}, `)} + base)
})()`,
  }
}
