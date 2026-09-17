/**
 * Stand-in for the client theme service, reproducing the two facts the font
 * presenter depends on: the service owns the document write, and it keeps one
 * token layer per source that a later call replaces and a disposer removes.
 *
 * The write itself mirrors ui-layout's theme presenter — inline CSS variables
 * on `body`, retracting exactly the names it wrote last time — so a spec
 * asserts against the document a browser would render, not against a call log.
 * @module dsh-plugin-ui-font-family/tests/client/theme-stub
 */

import type { ThemeTokenWriter } from '../../src/client/font-presenter.ts'

/** One token layer's value per palette mode. */
type TokenModes = Record<string, { light: string; dark: string }>

/** The theme service, reduced to the write path the presenter uses. */
export class FakeTheme {
  private readonly layers = new Map<string, TokenModes>()
  private written: string[] = []

  /**
   * Install or replace one source's token layer.
   * @param source - layer identity.
   * @param tokens - token names to per-mode values.
   * @returns disposer removing exactly the layer this call created.
   */
  overrideTokens(source: string, tokens: TokenModes): () => void {
    const layer: TokenModes = { ...tokens }
    this.layers.set(source, layer)
    this.publish()
    return () => {
      if (this.layers.get(source) !== layer) return
      this.layers.delete(source)
      this.publish()
    }
  }

  /** @returns the layer sources currently stacked, in installation order. */
  sources(): string[] {
    return [...this.layers.keys()]
  }

  /** @returns the tokens one source currently contributes, or undefined. */
  layerFor(source: string): TokenModes | undefined {
    return this.layers.get(source)
  }

  /** The service as the presenter's constructor takes it. */
  asService(): ThemeTokenWriter {
    return this
  }

  /** Replace the document's token variables, exactly as the theme presenter does. */
  private publish(): void {
    const body = document.body
    for (const name of this.written) body.style.removeProperty(name)
    this.written = []
    for (const layer of this.layers.values()) {
      for (const [name, modes] of Object.entries(layer)) {
        body.style.setProperty(name, modes.light)
        this.written.push(name)
      }
    }
  }
}
