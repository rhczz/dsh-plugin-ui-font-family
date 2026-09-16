/**
 * Host bootstrap row for the browser's pre-plugin interval.
 *
 * Mirrors ui-theme's own boot row: the script installs the token it can compute
 * from the persisted selection on `body`, the same element and property the
 * theme presenter writes later, so the client takes the value over by writing
 * the same thing rather than by unwinding a different one. The stack the
 * harness declares for itself is read back from the document, never restated
 * here — the theme owns that value and this row only places families ahead of
 * it. The read retracts this row's own write first, so re-running it composes
 * against the theme rather than against its own composition.
 * @module dsh-plugin-ui-font-family/boot-font
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { FONT_FAMILY_PROPERTY } from './font-selection.ts'

/** The index row kinds this plugin contributes. */
export type FontIndexInjection = Extract<IndexInjection, { kind: 'script' }>

/**
 * Build the row that places `families` ahead of the harness's own stack.
 *
 * Installs nothing when the document declares no stack of its own: a stack
 * naming only the chosen families would drop the faces the harness laid its
 * interface out for, so the harness font is the better outcome.
 * @param families - resolved families, already quoted and sanitized.
 * @returns the row to inject.
 */
export function bootFontInjection(families: string): FontIndexInjection {
  return {
    kind: 'script',
    placement: 'body',
    text: `(() => {
  const body = document.body
  body.style.removeProperty(${JSON.stringify(FONT_FAMILY_PROPERTY)})
  const base = getComputedStyle(body).getPropertyValue(${JSON.stringify(FONT_FAMILY_PROPERTY)}).trim()
  if (base !== '') body.style.setProperty(${JSON.stringify(FONT_FAMILY_PROPERTY)}, ${JSON.stringify(`${families}, `)} + base)
})()`,
  }
}
