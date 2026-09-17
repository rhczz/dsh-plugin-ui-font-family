/**
 * The single writer of this plugin's font token layer.
 *
 * The write belongs to the theme service (`ctx.theme.overrideTokens`), which
 * keeps one layer per source and replaces it on every call; ui-layout's
 * presenter puts the resolved tokens on the document. This class decides only
 * the value: the chosen families ahead of the harness's own stack.
 * @module dsh-plugin-ui-font-family/client/font-presenter
 */

import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { composeFontStack, FONT_FAMILY_PROPERTY } from '../font-selection.ts'

/** Layer identity; one layer per source, so a re-apply replaces rather than stacks. */
export const FONT_LAYER_SOURCE = '@deepseek-ai/dsh-plugin-ui-font-family'

/** The slice of the theme service this presenter writes through. */
export type ThemeTokenWriter = Pick<ThemeRuntime, 'overrideTokens'>

/** Places the chosen families ahead of the harness's own stack, through the theme service. */
export class FontPresenter {
  private readonly theme: ThemeTokenWriter
  private installed = ''
  private base = ''
  private retractLayer: (() => void) | undefined

  /**
   * @param theme - the client theme service; it owns the document write.
   */
  constructor(theme: ThemeTokenWriter) {
    this.theme = theme
  }

  /**
   * Read the stack this plugin installed.
   * @returns the installed stack; empty while the harness's own stack stands.
   */
  current(): string {
    return this.installed
  }

  /**
   * Read the stack the harness declares for itself.
   *
   * Callers previewing a font append this, so a preview draws the same faces an
   * installed stack would.
   * @returns the harness stack, or empty before the first {@link apply}.
   */
  harnessStack(): string {
    return this.base
  }

  /**
   * Install one selection, or clear the layer when the selection asks for the
   * harness's own font.
   *
   * The layer is retracted before the harness stack is read, so the value
   * revealed is the theme's declaration rather than this plugin's previous
   * composition. Both happen in one turn, so no frame is painted in between.
   * @param projection - families to place ahead of the harness stack, or
   * `undefined` to clear the layer.
   */
  apply(projection: string | undefined): void {
    this.retract()
    this.base = readHarnessStack()
    const stack = composeFontStack(projection ?? '', this.base)
    if (stack === undefined) return
    this.retractLayer = this.theme.overrideTokens(FONT_LAYER_SOURCE, {
      [FONT_FAMILY_PROPERTY]: { light: stack, dark: stack },
    })
    this.installed = stack
  }

  /**
   * Drop the layer, revealing the harness's own stack from the theme
   * stylesheet. Called when the plugin unloads, so disabling it restores the
   * default rather than freezing the last chosen font.
   */
  dispose(): void {
    this.retract()
  }

  /** Remove this plugin's layer and the bootstrap row it wrote. */
  private retract(): void {
    this.retractLayer?.()
    this.retractLayer = undefined
    this.installed = ''
    // The bootstrap row is this plugin's own earlier write, made before the
    // theme service existed; the presenter retracts only what it wrote itself.
    document.body.style.removeProperty(FONT_FAMILY_PROPERTY)
  }
}

/** @returns the stack the theme declares, read with this plugin's writes gone. */
function readHarnessStack(): string {
  return getComputedStyle(document.body).getPropertyValue(FONT_FAMILY_PROPERTY).trim()
}
