/**
 * Turning a persisted selection into the CSS installed on the document.
 *
 * {@link resolveFontProjection} decides which families the selection asks for;
 * {@link composeFontStack} places them ahead of the stack the harness defines
 * for itself, which is read from the document. The Host's boot script and the
 * browser's live projection both take these two steps, so the two cannot
 * install different stacks for one document.
 * @module dsh-plugin-ui-font-family/font-selection
 */

import { fontPresetFamilies, isFontPresetId } from './font-presets.ts'
import type { FontSettings } from './font-settings.ts'

/**
 * Dynamic catalogues a resolution may consult. Presets are compiled in and so
 * are absent here.
 */
export interface FontCatalogues {
  /**
   * Family name by uploaded font id, or `undefined` while the catalogue has not
   * been read.
   *
   * The distinction is load-bearing: a loaded map without the id proves the file
   * is gone and the selection resolves to the harness font, while an unread
   * catalogue proves nothing and leaves the current stack alone.
   */
  uploaded: ReadonlyMap<string, string> | undefined
}

/** Catalogue state before the browser has read anything from the Host. */
export const UNREAD_FONT_CATALOGUES: FontCatalogues = Object.freeze({ uploaded: undefined })

/**
 * Custom property the shell's `body` rule reads, and the property the theme
 * declares its own stack on. Named here because the Host's bootstrap script and
 * the browser's live projection both write it, and the two must never name
 * different properties.
 */
export const FONT_FAMILY_PROPERTY = '--dsw-font-family'

/**
 * What the document should carry for one selection.
 *
 * - `harness` — nothing. The stack the harness declares stands, which is what
 *   the default preset and a deleted upload both resolve to.
 * - `families` — these families, ahead of the harness stack.
 * - `unresolved` — the selection names a stored font and the catalogue that
 *   would name its family has not been read. A caller keeps what the document
 *   already carries rather than replacing a correct stack with a guess.
 */
export type FontProjection =
  | { readonly kind: 'harness' }
  | { readonly kind: 'families', readonly families: string }
  | { readonly kind: 'unresolved' }

/**
 * Quote a CSS family name unless it is already a bare identifier.
 *
 * Both characters that carry meaning inside a quoted CSS string are escaped: a
 * quote ends it, and a backslash escapes whatever follows, including the closing
 * quote. Installed names have already passed the gate in `font-settings.ts`; the
 * escapes cover a caller that does not.
 * @param name - family name as a font declares it.
 * @returns the name, quoted when it contains anything but identifier characters.
 */
export function quoteFontFamily(name: string): string {
  return /^[A-Za-z_][\w-]*$/.test(name)
    ? name
    : `'${name.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

/**
 * Resolve a selection to the families to install.
 *
 * Total over what the settings service can deliver: an id that names nothing
 * yields the harness font rather than an error, so a deleted upload or a preset
 * this build dropped degrades to a readable interface instead of a broken one.
 * @param settings - selection read from the settings document.
 * @param catalogues - dynamic catalogues currently known.
 * @returns what the document should carry for this selection.
 */
export function resolveFontProjection(settings: FontSettings, catalogues: FontCatalogues): FontProjection {
  switch (settings.source) {
    case 'preset': {
      if (!isFontPresetId(settings.id)) return { kind: 'harness' }
      const families = fontPresetFamilies(settings.id)
      // The default preset is the harness's own font, and the only way to
      // install that font is to install nothing.
      return families === '' ? { kind: 'harness' } : { kind: 'families', families }
    }
    case 'system':
      return settings.id === '' ? { kind: 'harness' } : { kind: 'families', families: quoteFontFamily(settings.id) }
    case 'upload': {
      const uploaded = catalogues.uploaded
      if (uploaded === undefined) return { kind: 'unresolved' }
      const family = uploaded.get(settings.id)
      return family === undefined ? { kind: 'harness' } : { kind: 'families', families: quoteFontFamily(family) }
    }
    default:
      // The settings service admits only ids in FONT_SOURCES, so a fourth case
      // cannot reach here without a schema change that must also change this
      // switch. The harness font keeps a page rendering if that ever drifts.
      return { kind: 'harness' }
  }
}

/**
 * Place chosen families ahead of the stack the harness declares for itself.
 *
 * The harness stack is the tail of every installed stack, so a family this
 * plugin names is tried first and everything it cannot draw — Chinese text, an
 * emoji, a symbol, a missing family — is drawn as the harness draws it. The
 * plugin adds a face and never reorders the ones the layout was measured for.
 * @param families - families the selection resolved to.
 * @param harnessStack - stack declared by the harness, read from the document.
 * @returns the stack to install, or `undefined` when the document keeps the
 * harness stack: nothing was chosen, or the harness stack could not be read and
 * there is no tail to append.
 */
export function composeFontStack(families: string, harnessStack: string): string | undefined {
  if (families === '' || harnessStack === '') return undefined
  return `${families}, ${harnessStack}`
}

/**
 * Judge whether a selection still names a font the user can get. What the row
 * reports, and more forgiving than {@link resolveFontProjection}: a `system`
 * selection is a CSS family name and counts as available wherever the browser
 * might find it, and an `upload` selection counts as available until a read
 * catalogue proves the file gone.
 * @param settings - selection read from the settings document.
 * @param catalogues - dynamic catalogues currently known.
 * @returns whether the selection names a font that still exists.
 */
export function isFontSelectionAvailable(settings: FontSettings, catalogues: FontCatalogues): boolean {
  switch (settings.source) {
    case 'preset':
      return isFontPresetId(settings.id)
    case 'system':
      return settings.id !== ''
    case 'upload':
      return catalogues.uploaded === undefined || catalogues.uploaded.has(settings.id)
    default:
      return false
  }
}
