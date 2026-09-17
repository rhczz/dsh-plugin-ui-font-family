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

/**
 * Store state: the runtime snapshot itself, so a snapshot field cannot exist
 * without the row seeing it. `seq` starts at -1 in {@link createFontRowStore} so
 * the runtime's opening snapshot (sequence 0) lands as the first change.
 */
export type FontRowState = FontRowSnapshot

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
      directory: null,
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
        Object.assign(d, snapshot)
      },
    },
  })
}
