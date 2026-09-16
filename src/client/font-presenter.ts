/**
 * The single writer of this plugin's font token layer.
 *
 * The write itself belongs to the harness: `ctx.theme.overrideTokens` is the
 * theme service's published way to stack a token layer over the active theme,
 * and ui-layout's theme presenter is what puts it on the document. This class
 * only decides the value — the chosen families placed ahead of the stack the
 * harness declares for itself — and keeps that decision idempotent, because
 * the theme service keeps one layer per source and replaces it on every call.
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
   * @returns the stack this plugin installed; empty while the harness's own
   * stack stands.
   */
  current(): string {
    return this.installed
  }

  /**
   * @returns the stack the harness declares for itself, or empty before the
   * first {@link apply}. Callers previewing a font append this so the preview
   * draws the same faces an installed stack would.
   */
  harnessStack(): string {
    return this.base
  }

  /**
   * Install one selection, or clear the layer when the selection asks for the
   * harness's own font.
   *
   * The layer is retracted before the harness stack is read, so the value
   * revealed is the theme's declaration rather than this plugin's own previous
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
    // The bootstrap row is this plugin's own write, made before the theme
    // service existed. The presenter only retracts what it wrote itself, so
    // the row has to go here or it would outlive the selection that caused it.
    document.body.style.removeProperty(FONT_FAMILY_PROPERTY)
  }
}

/** @returns the stack the theme declares, read with this plugin's writes gone. */
function readHarnessStack(): string {
  return getComputedStyle(document.body).getPropertyValue(FONT_FAMILY_PROPERTY).trim()
}
