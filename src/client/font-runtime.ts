/**
 * Browser-side state of the font row: the persisted selection, both
 * catalogues, and the projected stack.
 *
 * One runtime owns every mutation. It is the only caller of the Host routes
 * and the only writer of the projected property, so the row and its dialog
 * cannot disagree about what is selected or what is stored.
 * @module dsh-plugin-ui-font-family/client/font-runtime
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FontSystemUnavailableReason, FontUploadSummary } from '../font-api.ts'
import { fontFaceCss } from '../font-face.ts'
import { FontFaceStyle } from './font-face-style.ts'
import {
  DEFAULT_FONT_SOURCE,
  FONT_ID_FIELD,
  FONT_SOURCE_FIELD,
  type FontSettings,
  type FontSource,
} from '../font-settings.ts'
import { DEFAULT_FONT_PRESET_ID } from '../font-presets.ts'
import {
  isFontSelectionAvailable,
  resolveFontProjection,
  UNREAD_FONT_CATALOGUES,
  type FontCatalogues,
} from '../font-selection.ts'
import {
  deleteFontFile,
  EMPTY_FONT_CATALOG,
  fetchFontCatalog,
  FontRequestError,
  uploadFontFile,
  type FontCatalog,
} from './font-catalog.ts'
import { FontPresenter, type ThemeTokenWriter } from './font-presenter.ts'

/** Catalogue read state of the row. */
export type FontCatalogStatus = 'loading' | 'ready' | 'failed'

/**
 * Outcome of the last write, as a code the row localizes. Codes rather than
 * text, because copy belongs to the locale dictionary.
 */
export type FontNotice =
  | ''
  | 'uploaded'
  | 'removed'
  | 'reset'
  | 'uploadFailed'
  | 'removeFailed'
  | 'settingsFailed'
  | 'tooLarge'

/** Immutable view of everything the settings row renders. */
export interface FontRowSnapshot {
  /** Monotonic sequence; a consumer drops a snapshot that is not newer. */
  seq: number
  /** Persisted selection, as the settings document holds it. */
  selection: FontSettings
  /** Catalogue read state. */
  catalog: FontCatalogStatus
  /** Reason the catalogue read failed; empty unless `catalog` is `failed`. */
  catalogError: string
  /** Absolute directory holding uploaded fonts; empty before the first read. */
  directory: string
  /** Installed families, or null when the Host did not enumerate them. */
  system: readonly string[] | null
  /** Why `system` is null; null before the first successful catalogue read. */
  systemUnavailable: FontSystemUnavailableReason | null
  /** Uploaded fonts. */
  uploaded: readonly FontUploadSummary[]
  /** Stack currently installed; empty while the harness's own stack stands. */
  stack: string
  /** Stack the harness declares for itself, which every installed stack ends in. */
  harnessStack: string
  /** Whether the selection still names a font that exists. */
  available: boolean
  /** Whether a catalogue write is in flight. */
  busy: boolean
  /** Outcome of the last write. */
  notice: FontNotice
  /** Detail behind a failed write, verbatim from the Host; empty otherwise. */
  noticeDetail: string
}

/** Sort uploaded fonts the way the catalogue reads, so both orders agree. */
function byFamily(left: FontUploadSummary, right: FontUploadSummary): number {
  return left.family.localeCompare(right.family)
}

/** Map a failed catalogue request to the code the row reports. */
function failureCode(error: unknown, fallback: FontNotice): FontNotice {
  if (error instanceof FontRequestError && error.status === 413) return 'tooLarge'
  return fallback
}

/** Font row state and the operations the settings page performs on it. */
export class FontRuntime {
  private readonly host: SettingsScope<FontSettings>
  private readonly presenter: FontPresenter
  private readonly faces: FontFaceStyle
  private readonly listeners = new Set<() => void>()
  private readonly abort = new AbortController()

  private catalog: FontCatalog = EMPTY_FONT_CATALOG
  private catalogStatus: FontCatalogStatus = 'loading'
  private catalogError = ''
  private selection: FontSettings = { source: DEFAULT_FONT_SOURCE, id: DEFAULT_FONT_PRESET_ID }
  private available = true
  private busy = false
  private notice: FontNotice = ''
  private noticeDetail = ''
  private seq = 0
  private disposed = false
  private snapshot: FontRowSnapshot

  /**
   * @param host - durable settings scope owned by the same plugin; the runtime
   * never binds its own, so one namespace has one writer.
   * @param theme - client theme service; it owns the document write.
   */
  constructor(host: SettingsScope<FontSettings>, theme: ThemeTokenWriter) {
    this.host = host
    this.presenter = new FontPresenter(theme)
    this.faces = new FontFaceStyle()
    this.snapshot = this.buildSnapshot()
  }

  /**
   * Adopt the settings document, then read the catalogue.
   * @returns the subscription disposer, owned by the caller's effect.
   */
  start(): () => void {
    const unsubscribe = this.host.subscribe(() => { this.adopt() })
    this.adopt()
    this.reloadCatalog()
    return unsubscribe
  }

  /**
   * Read the current view.
   * @returns the snapshot; the same reference until the next change.
   */
  getSnapshot(): FontRowSnapshot {
    return this.snapshot
  }

  /**
   * Subscribe to view changes.
   * @param listener - called after each published snapshot.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Select one font from one catalogue.
   * @param source - catalogue the id indexes.
   * @param id - preset id, system family name, or stored font id.
   */
  select(source: FontSource, id: string): void {
    this.selection = { source, id }
    this.setNotice('', '')
    this.project()
    this.publish()
    // One write for both fields. Two writes would validate `source` against a
    // stale `id`, and a system family name is not a preset id, so a legal
    // switch away from a preset would be refused mid-transition.
    this.write([
      { op: 'set', path: [FONT_SOURCE_FIELD], value: source },
      { op: 'set', path: [FONT_ID_FIELD], value: id },
    ], 'settingsFailed')
  }

  /**
   * Clear the user's choice, revealing the profile's composition default.
   */
  reset(): void {
    this.selection = { source: DEFAULT_FONT_SOURCE, id: DEFAULT_FONT_PRESET_ID }
    this.setNotice('reset', '')
    this.project()
    this.publish()
    this.write([
      { op: 'unset', path: [FONT_SOURCE_FIELD] },
      { op: 'unset', path: [FONT_ID_FIELD] },
    ], 'settingsFailed')
  }

  /** Read the catalogue again, e.g. after a font was installed by hand. */
  reloadCatalog(): void {
    this.catalogStatus = 'loading'
    this.publish()
    void fetchFontCatalog(this.abort.signal)
      .then((catalog) => {
        if (this.disposed) return
        this.catalog = catalog
        this.catalogStatus = 'ready'
        this.catalogError = ''
        this.project()
        this.publish()
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.catalogStatus = 'failed'
        this.catalogError = error instanceof Error ? error.message : String(error)
        // The projected stack is left alone: it came from the Host bootstrap
        // row, which had this catalogue, and falling back here would replace a
        // correct font with a guess.
        this.publish()
      })
  }

  /**
   * Store one font file and select it.
   * @param file - file the user chose or dropped.
   */
  upload(file: File): void {
    this.busy = true
    this.setNotice('', '')
    this.publish()
    void file.arrayBuffer()
      .then(async (bytes) => uploadFontFile(bytes, this.abort.signal))
      .then((summary) => {
        if (this.disposed) return
        this.busy = false
        // Fold the stored entry into the catalogue before selecting it, so the
        // new font resolves on this publish instead of after a second read.
        this.catalog = {
          ...this.catalog,
          uploaded: [...this.catalog.uploaded, summary].sort(byFamily),
        }
        this.catalogStatus = 'ready'
        this.selection = { source: 'upload', id: summary.id }
        this.setNotice('uploaded', summary.family)
        this.project()
        this.publish()
        this.write([
          { op: 'set', path: [FONT_SOURCE_FIELD], value: 'upload' },
          { op: 'set', path: [FONT_ID_FIELD], value: summary.id },
        ], 'uploadFailed')
        this.reloadCatalog()
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.busy = false
        this.setNotice(failureCode(error, 'uploadFailed'), error instanceof Error ? error.message : String(error))
        this.publish()
      })
  }

  /**
   * Delete one stored font. Deleting the font in use clears the selection, so
   * no document is left pointing at a file that is gone.
   * @param id - stored font id.
   */
  remove(id: string): void {
    this.busy = true
    this.setNotice('', '')
    this.publish()
    void deleteFontFile(id, this.abort.signal)
      .then(() => {
        if (this.disposed) return
        this.busy = false
        this.catalog = {
          ...this.catalog,
          uploaded: this.catalog.uploaded.filter(entry => entry.id !== id),
        }
        if (this.selection.source === 'upload' && this.selection.id === id) {
          this.selection = { source: DEFAULT_FONT_SOURCE, id: DEFAULT_FONT_PRESET_ID }
          this.setNotice('removed', '')
          this.write([
            { op: 'unset', path: [FONT_SOURCE_FIELD] },
            { op: 'unset', path: [FONT_ID_FIELD] },
          ], 'removeFailed')
        } else {
          this.setNotice('removed', '')
        }
        this.project()
        this.publish()
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.busy = false
        this.setNotice(failureCode(error, 'removeFailed'), error instanceof Error ? error.message : String(error))
        this.publish()
      })
  }

  /** Release the request controller and retract the projected stack. */
  dispose(): void {
    this.disposed = true
    this.abort.abort()
    this.listeners.clear()
    this.presenter.dispose()
    this.faces.dispose()
  }

  /** Adopt the resolved settings document value and re-project. */
  private adopt(): void {
    const value = this.host.getSnapshot().value
    if (value !== undefined) this.selection = value
    this.project()
    this.publish()
  }

  /**
   * Resolve the selection and install the stack.
   *
   * The catalogue is reported unread until a successful read, so an `upload`
   * selection keeps the stack the Host already installed rather than flashing
   * a fallback while the catalogue is in flight.
   */
  private project(): void {
    const catalogues: FontCatalogues = this.catalogStatus === 'ready'
      ? { uploaded: new Map(this.catalog.uploaded.map(entry => [entry.id, entry.family])) }
      : UNREAD_FONT_CATALOGUES
    // Naming a family the browser has no source for paints the fallback, so the
    // declarations are installed before the stack that names them. An unread
    // catalogue leaves the block the Host rendered untouched rather than
    // clearing rules the selection may still need.
    if (catalogues.uploaded !== undefined) this.faces.apply(fontFaceCss(catalogues.uploaded))
    this.available = isFontSelectionAvailable(this.selection, catalogues)
    const projection = resolveFontProjection(this.selection, catalogues)
    // An unresolved selection keeps the stack the Host installed, which had
    // this catalogue; resolving it to the harness font here would replace a
    // correct font with a guess while the read is still in flight.
    if (projection.kind === 'unresolved') return
    this.presenter.apply(projection.kind === 'families' ? projection.families : undefined)
  }

  /**
   * Queue one settings write, reporting a refusal rather than dropping it.
   * @param ops - path operations applied as one validated write.
   * @param code - outcome to report when the document refuses the write; the
   * caller names the action, because a refused selection is not a failed
   * upload and saying so would send the user looking at the wrong thing.
   */
  private write(ops: readonly SettingsPathOpView[], code: FontNotice): void {
    void this.host.mutate(ops).catch((error: unknown) => {
      if (this.disposed) return
      this.setNotice(code, error instanceof Error ? error.message : String(error))
      this.publish()
    })
  }

  /**
   * Set the reported outcome.
   * @param notice - outcome code.
   * @param detail - detail behind a failure, or the affected family name.
   */
  private setNotice(notice: FontNotice, detail: string): void {
    this.notice = notice
    this.noticeDetail = detail
  }

  /** Freeze the current state into a new snapshot and notify subscribers. */
  private publish(): void {
    this.seq += 1
    this.snapshot = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }

  /** @returns a snapshot of the current field values. */
  private buildSnapshot(): FontRowSnapshot {
    return {
      seq: this.seq,
      selection: this.selection,
      catalog: this.catalogStatus,
      catalogError: this.catalogError,
      directory: this.catalog.directory,
      system: this.catalog.system,
      systemUnavailable: this.catalog.systemUnavailable,
      uploaded: this.catalog.uploaded,
      stack: this.presenter.current(),
      harnessStack: this.presenter.harnessStack(),
      available: this.available,
      busy: this.busy,
      notice: this.notice,
      noticeDetail: this.noticeDetail,
    }
  }
}
