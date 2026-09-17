// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, inject } from '../../src/client/index.ts'
import { FontFamilyRow } from '../../src/client/FontFamilyRow.tsx'
import { FONT_LOCALE_NAMESPACE, en, zh } from '../../src/client/locales.ts'
import { FONT_CATALOG_ROUTE, FONT_COLLECTION_ROUTE } from '../../src/font-api.ts'
import { FONT_SETTINGS_NAMESPACE } from '../../src/font-settings.ts'
import { FONT_FAMILY_PROPERTY } from '../../src/font-selection.ts'
import { normalizeStack } from '../css-text.ts'
import { FakeScope } from './scope-stub.ts'
import { FakeTheme } from './theme-stub.ts'

/** Stack the harness declares for itself, which every composition appends. */
const HARNESS_STACK = "-apple-system, 'PingFang SC', sans-serif"

/** One contribution the plugin body registered through `ctx.effect`. */
interface Effect {
  label: string
  dispose: () => void
}

/** One row the plugin body registered into a slot. */
interface Row {
  row: Record<string, unknown>
  component: unknown
}

/** Everything one mounted plugin body exposes to a spec. */
interface Mounted {
  ctx: ClientContext
  scope: FakeScope
  boundNamespace: () => string | undefined
  theme: FakeTheme
  effects: Effect[]
  dictionaries: { namespace: string; values: Record<string, unknown> }[]
  rows: Row[]
  slotsInjected: string[]
}

/**
 * Mount the plugin body over service doubles that record what it contributes,
 * the way the client Loader would hand it the real ones.
 * @returns the mounted body and its contributions.
 */
function mount(): Mounted {
  const scope = new FakeScope({ source: 'preset', id: 'default' })
  const theme = new FakeTheme()
  const effects: Effect[] = []
  const dictionaries: Mounted['dictionaries'] = []
  const rows: Row[] = []
  const slotsInjected: string[] = []
  let namespace: string | undefined

  const ctx = {
    settingsScope: {
      bind: (spec: { namespace: string }) => {
        namespace = spec.namespace
        return scope.asScope()
      },
    },
    locale: {
      register: (dictionaryNamespace: string, values: Record<string, unknown>) => {
        dictionaries.push({ namespace: dictionaryNamespace, values })
        return () => { dictionaries.pop() }
      },
    },
    theme: theme.asService(),
    effect: (run: () => unknown, label: string) => {
      const dispose = run()
      effects.push({ label, dispose: typeof dispose === 'function' ? dispose as () => void : () => {} })
    },
    slots: {
      inject: (name: string, body: () => unknown) => { slotsInjected.push(name); body() },
      register: (row: Record<string, unknown>, component: unknown) => {
        rows.push({ row, component })
        return () => {}
      },
    },
  }

  const context = ctx as unknown as ClientContext
  apply(context)
  return {
    ctx: context,
    scope,
    boundNamespace: () => namespace,
    theme,
    effects,
    dictionaries,
    rows,
    slotsInjected,
  }
}

/**
 * Ask the registered row for its injected actions, the way the slot renderer
 * does when it first renders the row.
 * @param mounted - the mounted body.
 * @param sync - records the snapshots the row publishes into its store.
 * @returns the action bag the row was handed.
 */
function actionsOf(mounted: Mounted, sync: (snapshot: unknown) => void): Record<string, unknown> {
  const injectActions = mounted.rows[0]?.row.inject as (actions: unknown) => Record<string, unknown>
  return injectActions({ sync })
}

/**
 * Answer the three routes the runtime talks to, the way the Host would.
 * @param input - request URL.
 * @returns a JSON response carrying that route's body.
 */
async function hostAnswer(input: string): Promise<unknown> {
  const url = input
  const body = url.includes(FONT_COLLECTION_ROUTE) && !url.endsWith(FONT_COLLECTION_ROUTE)
    ? {}
    : url.includes(FONT_CATALOG_ROUTE)
      ? { fontDir: '/home/example/.dsh/fonts', system: [], systemUnavailable: null, uploaded: [] }
      : { id: 'Example-1a2b3c4d.ttf', family: 'Example' }
  return { ok: true, status: 200, json: async () => body }
}

/** One request the runtime sent, in the order it sent them. */
interface SentRequest {
  url: string
  method: string
}

/** Every request the runtime sent during the current case. */
const sent: SentRequest[] = []

/**
 * @param method - HTTP method to look for.
 * @returns the first request the runtime sent with it, or undefined.
 */
function issued(method: string): SentRequest | undefined {
  return sent.find(request => request.method === method)
}

let mounted: Mounted

beforeEach(() => {
  // The harness declares its own stack in the theme stylesheet, so removing
  // this plugin's inline layer reveals it again — the way it works in a browser.
  const style = document.createElement('style')
  style.textContent = `:root { ${FONT_FAMILY_PROPERTY}: ${HARNESS_STACK} }`
  document.head.appendChild(style)
  sent.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    sent.push({ url: input, method: init?.method ?? 'GET' })
    return hostAnswer(input)
  }))
  mounted = mount()
})

afterEach(() => {
  for (const effect of mounted.effects) effect.dispose()
  vi.unstubAllGlobals()
  document.body.removeAttribute('style')
  for (const style of document.head.querySelectorAll('style')) style.remove()
})

describe('the plugin body', () => {
  it('declares the services it cannot run without', () => {
    expect([...inject].sort()).toEqual(['locale', 'remote', 'settingsScope', 'slots', 'theme'])
  })

  it('binds its own settings namespace, not another feature\'s', () => {
    expect(mounted.boundNamespace()).toBe(FONT_SETTINGS_NAMESPACE)
  })

  it('registers its dictionaries under its own namespace, in both locales', () => {
    expect(mounted.dictionaries).toHaveLength(1)
    expect(mounted.dictionaries[0]?.namespace).toBe(FONT_LOCALE_NAMESPACE)
    expect(mounted.dictionaries[0]?.values).toEqual({ zh, en })
  })

  it('registers one row into the General section item slot', () => {
    expect(mounted.slotsInjected).toEqual(['settings.general.item'])
    expect(mounted.rows).toHaveLength(1)
    expect(mounted.rows[0]?.row).toMatchObject({
      name: 'settings.general.item',
      id: 'font-family',
      locale: FONT_LOCALE_NAMESPACE,
    })
  })

  it('sits between the font-size row and the transcript-view row', () => {
    expect(mounted.rows[0]?.row.order).toBe(11.5)
  })

  it('renders the font row and hands it the store the row reads', () => {
    expect(mounted.rows[0]?.component).toBe(FontFamilyRow)
    expect(mounted.rows[0]?.row.store).toBeDefined()
  })

  it('publishes a snapshot as soon as the row asks for its actions', () => {
    const sync = vi.fn()
    actionsOf(mounted, sync)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync.mock.calls[0]?.[0]).toMatchObject({ selection: { source: 'preset', id: 'default' } })
  })

  it('writes a chosen preset through to the settings namespace', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'serif')
    await vi.waitFor(() => { expect(mounted.scope.batches).toHaveLength(1) })
    expect(mounted.scope.batches[0]).toEqual([
      { op: 'set', path: ['source'], value: 'preset' },
      { op: 'set', path: ['id'], value: 'serif' },
    ])
  })

  it('projects the chosen font onto the theme, ahead of the harness stack', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'serif')
    await vi.waitFor(() => { expect(mounted.theme.sources()).toHaveLength(1) })
    const layer = mounted.theme.layerFor(mounted.theme.sources()[0] ?? '')
    const installed = normalizeStack(layer?.[FONT_FAMILY_PROPERTY]?.light ?? '')
    expect(installed.startsWith('Georgia')).toBe(true)
    expect(installed.endsWith(normalizeStack(HARNESS_STACK))).toBe(true)
  })

  it('clears the layer again when the row asks for the default', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'serif')
    await vi.waitFor(() => { expect(mounted.theme.sources()).toHaveLength(1) })
    ;(actions.reset as () => void)()
    await vi.waitFor(() => { expect(mounted.theme.sources()).toEqual([]) })
  })

  it('takes its layer back when the plugin unloads', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'serif')
    await vi.waitFor(() => { expect(mounted.theme.sources()).toHaveLength(1) })
    for (const effect of mounted.effects) effect.dispose()
    expect(mounted.theme.sources()).toEqual([])
  })

  it('names every effect it registers, so a teardown is traceable', () => {
    expect(mounted.effects.map(effect => effect.label)).toEqual([
      'ui-font-family: settings row dictionaries',
      'ui-font-family: font runtime',
    ])
  })

  it('reloads the catalogue on demand', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.reload as () => void)()
    await vi.waitFor(() => { expect(sent).toHaveLength(2) })
    expect(sent[1]?.url).toContain(FONT_CATALOG_ROUTE)
  })

  it('forwards the rescan the row asks for, so the installed fonts are read again', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.reload as (options: { system?: boolean }) => void)({ system: true })
    await vi.waitFor(() => { expect(sent).toHaveLength(2) })
    expect(sent[1]?.url).toContain('?system=refresh')
  })

  it('stores a file the row uploads, under the collection route', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.upload as (file: File) => void)(new File([new Uint8Array([0, 1, 2, 3])], 'Example.ttf'))
    await vi.waitFor(() => { expect(issued('POST')).toBeDefined() })
    expect(issued('POST')?.url).toContain(FONT_COLLECTION_ROUTE)
    expect(issued('POST')?.url).not.toContain('Example.ttf')
  })

  it('deletes the stored font the row names', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.remove as (id: string) => void)('Example-1a2b3c4d.ttf')
    await vi.waitFor(() => { expect(issued('DELETE')).toBeDefined() })
    expect(issued('DELETE')?.url).toContain(`${FONT_COLLECTION_ROUTE}/Example-1a2b3c4d.ttf`)
  })
})
