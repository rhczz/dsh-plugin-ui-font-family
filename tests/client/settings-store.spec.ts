import { describe, expect, it } from 'vitest'
import type { FontRowSnapshot } from '../../src/client/font-runtime.ts'
import { createFontRowStore } from '../../src/client/settings-store.ts'

/** Stack the harness declares for itself; every installed stack ends in it. */
const HARNESS_STACK = "-apple-system, 'PingFang SC', sans-serif"

/**
 * Build a runtime snapshot with everything a case does not care about fixed.
 * @param overrides - fields this case exercises.
 * @returns the snapshot.
 */
function snapshot(overrides: Partial<FontRowSnapshot> = {}): FontRowSnapshot {
  return {
    seq: 0,
    selection: { source: 'preset', id: 'default' },
    catalog: 'ready',
    catalogError: '',
    directory: '/home/example/.dsh/fonts',
    system: ['Georgia'],
    systemUnavailable: null,
    uploaded: [],
    stack: 'Georgia, sans-serif',
    harnessStack: HARNESS_STACK,
    available: true,
    busy: false,
    notice: '',
    noticeDetail: '',
    ...overrides,
  }
}

describe('the font row store', () => {
  it('starts on a usable selection before anything syncs', () => {
    const state = createFontRowStore().create().getSnapshot()
    expect(state.seq).toBe(-1)
    expect(state.selection).toEqual({ source: 'preset', id: 'default' })
    expect(state.catalog).toBe('loading')
    expect(state.uploaded).toEqual([])
  })

  it('adopts every field of a snapshot', () => {
    const store = createFontRowStore().create()
    const next = snapshot({
      seq: 4,
      selection: { source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' },
      catalog: 'failed',
      catalogError: 'fetch failed',
      uploaded: [{ id: 'silkscreen-1a2b3c4d.ttf', family: 'Silkscreen' }],
      stack: 'Silkscreen, sans-serif',
      available: false,
      busy: true,
      notice: 'uploadFailed',
      noticeDetail: 'not a font',
    })
    store.actions.sync(next)
    const state = store.getSnapshot()
    expect(state.seq).toBe(4)
    expect(state.selection).toEqual(next.selection)
    expect(state.catalog).toBe('failed')
    expect(state.catalogError).toBe('fetch failed')
    expect(state.directory).toBe(next.directory)
    expect(state.system).toEqual(['Georgia'])
    expect(state.uploaded).toEqual(next.uploaded)
    expect(state.stack).toBe('Silkscreen, sans-serif')
    expect(state.available).toBe(false)
    expect(state.busy).toBe(true)
    expect(state.notice).toBe('uploadFailed')
    expect(state.noticeDetail).toBe('not a font')
  })

  it('drops a snapshot that is not newer', () => {
    const store = createFontRowStore().create()
    store.actions.sync(snapshot({ seq: 3, stack: 'first' }))
    store.actions.sync(snapshot({ seq: 3, stack: 'same sequence' }))
    store.actions.sync(snapshot({ seq: 2, stack: 'older' }))
    expect(store.getSnapshot().stack).toBe('first')
  })

  it('accepts the very first published sequence', () => {
    const store = createFontRowStore().create()
    // The runtime publishes sequence 0 before adopting anything, so the guard
    // must let it through rather than treating it as stale.
    store.actions.sync(snapshot({ seq: 0, stack: 'booted' }))
    expect(store.getSnapshot().stack).toBe('booted')
    expect(store.getSnapshot().seq).toBe(0)
  })
})
