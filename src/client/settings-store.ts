/**
 * Font row slot store: a mirror of the font runtime snapshot. The plugin's
 * apply-world runtime is the only writer; the row and its dialog read through
 * `props.useStore`.
 * @module dsh-plugin-ui-font-family/client/settings-store
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_FONT_SOURCE } from '../font-settings.ts'
import { DEFAULT_FONT_PRESET_ID } from '../font-presets.ts'
import type { FontRowSnapshot } from './font-runtime.ts'

/** Store state mirrored from the font runtime snapshot. */
export interface FontRowState {
  /** Snapshot sequence; -1 until the first sync so sequence 0 lands as a change. */
  seq: number
  /** Persisted selection, as the settings document holds it. */
  selection: FontRowSnapshot['selection']
  /** Catalogue read state. */
  catalog: FontRowSnapshot['catalog']
  /** Reason the catalogue read failed; empty unless `catalog` is `failed`. */
  catalogError: string
  /** Absolute directory holding uploaded fonts. */
  directory: string
  /** Installed families, or null when the Host did not enumerate them. */
  system: readonly string[] | null
  /** Why `system` is null; null when it is not. */
  systemUnavailable: FontRowSnapshot['systemUnavailable']
  /** Uploaded fonts. */
  uploaded: FontRowSnapshot['uploaded']
  /** Stack currently installed; empty while the harness's own stack stands. */
  stack: string
  /** Stack the harness declares for itself; a preview appends it. */
  harnessStack: string
  /** Whether the selection still names a font that exists. */
  available: boolean
  /** Whether a catalogue write is in flight. */
  busy: boolean
  /** Outcome of the last write. */
  notice: FontRowSnapshot['notice']
  /** Detail behind a failed write; empty otherwise. */
  noticeDetail: string
}

/** Declared action shape giving the exported factory a stable return type. */
type FontRowActions = {
  sync: (draft: FontRowState, snapshot: FontRowSnapshot) => void
}

/**
 * Declare the font row state and write surface.
 * @returns the store handle.
 */
export function createFontRowStore(): EngineStoreHandle<FontRowState, FontRowActions> {
  return defineStore({
    init: (): FontRowState => ({
      seq: -1,
      selection: { source: DEFAULT_FONT_SOURCE, id: DEFAULT_FONT_PRESET_ID },
      catalog: 'loading',
      catalogError: '',
      directory: '',
      system: null,
      systemUnavailable: null,
      uploaded: [],
      stack: '',
      harnessStack: '',
      available: true,
      busy: false,
      notice: '',
      noticeDetail: '',
    }),
    actions: {
      sync: (d, snapshot: FontRowSnapshot) => {
        if (snapshot.seq <= d.seq) return
        d.seq = snapshot.seq
        d.selection = snapshot.selection
        d.catalog = snapshot.catalog
        d.catalogError = snapshot.catalogError
        d.directory = snapshot.directory
        d.system = snapshot.system
        d.systemUnavailable = snapshot.systemUnavailable
        d.uploaded = snapshot.uploaded
        d.stack = snapshot.stack
        d.harnessStack = snapshot.harnessStack
        d.available = snapshot.available
        d.busy = snapshot.busy
        d.notice = snapshot.notice
        d.noticeDetail = snapshot.noticeDetail
      },
    },
  })
}
