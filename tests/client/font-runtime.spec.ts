// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { composeFontStack, FONT_FAMILY_PROPERTY } from '../../src/font-selection.ts'
import { FONT_FACE_STYLE_ID } from '../../src/font-face.ts'
import { fontPresetFamilies } from '../../src/font-presets.ts'
import type { FontSettings } from '../../src/font-settings.ts'
import { FontRuntime } from '../../src/client/font-runtime.ts'
import { normalizeStack } from '../css-text.ts'
import { FakeScope } from './scope-stub.ts'
import { FakeTheme } from './theme-stub.ts'

/** Catalogue body the fake Host answers with unless a case overrides it. */
const CATALOG = {
  fontDir: '/home/example/.dsh/fonts',
  system: ['Georgia', 'Silkscreen'],
  systemUnavailable: null,
  uploaded: [] as { id: string; family: string }[],
}

/** One request the runtime sent. */
interface FetchCall {
  url: string
  method: string
}

/** Answers the fake Host gives, per route. */
interface HostAnswers {
  catalog?: () => Response | Promise<Response>
  upload?: () => Response | Promise<Response>
  remove?: () => Response | Promise<Response>
}

/** The fake Host installed for one case. */
interface FakeHost {
  calls: FetchCall[]
  /** Serve one upload or deletion from now on. */
  answer: (answers: HostAnswers) => void
}

/**
 * Build a JSON response the way the Host route layer would.
 * @param body - JSON body.
 * @param status - HTTP status.
 * @returns the response double.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response
}

/**
 * Install a fetch double routing by path and method.
 * @param answers - responses keyed by the operation they serve.
 * @returns the recorded calls and a way to change the answers.
 */
function installFetch(answers: HostAnswers = {}): FakeHost {
  const calls: FetchCall[] = []
  const current: HostAnswers = { ...answers }
  const stub = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url: input, method })
    if (input.endsWith('/catalog')) return (current.catalog ?? (() => jsonResponse(CATALOG)))()
    if (method === 'POST') return (current.upload ?? (() => jsonResponse({ id: 'new.ttf', family: 'New' }, 201)))()
    return (current.remove ?? (() => jsonResponse(undefined, 204)))()
  })
  vi.stubGlobal('fetch', stub)
  return { calls, answer: (next) => { Object.assign(current, next) } }
}

/** A runtime under test together with the scope it writes through. */
interface Mounted {
  runtime: FontRuntime
  scope: FakeScope
  theme: FakeTheme
}

/**
 * Build a runtime over a fresh scope and start it.
 * @param base - composition layer the scope resolves over.
 * @returns the started runtime and its scope.
 */
function mount(base: FontSettings = { source: 'preset', id: 'default' }): Mounted {
  const scope = new FakeScope(base)
  const theme = new FakeTheme()
  const runtime = new FontRuntime(scope.asScope(), theme.asService())
  runtime.start()
  return { runtime, scope, theme }
}

/** Stack the harness declares for itself, in the theme stylesheet. */
const HARNESS_STACK = "-apple-system, 'PingFang SC', sans-serif"

/**
 * Declare the harness stack the way the theme does, from a stylesheet: the
 * presenter retracts the inline property before reading it, so an inline value
 * would be retracted with it.
 */
function declareHarnessStack(): void {
  const style = document.createElement('style')
  style.textContent = `:root { ${FONT_FAMILY_PROPERTY}: ${HARNESS_STACK} }`
  document.head.appendChild(style)
}

/** The stack currently installed on the document. */
function projected(): string {
  return normalizeStack(document.body.style.getPropertyValue(FONT_FAMILY_PROPERTY))
}

/**
 * The stack a selection is expected to install.
 * @param families - families the selection resolved to; empty for the harness font.
 * @returns the composed stack, or the empty string when nothing is installed.
 */
function installedFor(families: string): string {
  return normalizeStack(composeFontStack(families, HARNESS_STACK) ?? '')
}

/** The stack one preset installs. */
function presetStack(id: Parameters<typeof fontPresetFamilies>[0]): string {
  return installedFor(fontPresetFamilies(id))
}

/** Let every queued promise callback run. */
async function settle(): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 0) })
}

beforeEach(() => { declareHarnessStack() })

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.removeAttribute('style')
  for (const style of document.head.querySelectorAll('style')) style.remove()
  document.getElementById(FONT_FACE_STYLE_ID)?.remove()
})

/** The declarations element as the document currently holds it. */
function faceBlock(): HTMLStyleElement | null {
  const found = document.getElementById(FONT_FACE_STYLE_ID)
  return found instanceof HTMLStyleElement ? found : null
}

describe('adopting the settings document', () => {
  it('projects the boot stack when the catalogue holds no uploaded fonts', async () => {
    installFetch()
    const { runtime } = mount()
    await settle()
    expect(runtime.getSnapshot().catalog).toBe('ready')
    expect(runtime.getSnapshot().directory).toBe(CATALOG.fontDir)
    expect(runtime.getSnapshot().system).toEqual(['Georgia', 'Silkscreen'])
  })

  it('reports the resolved value the scope hands it', async () => {
    installFetch()
    const { runtime } = mount({ source: 'system', id: 'Georgia' })
    await settle()
    expect(runtime.getSnapshot().selection).toEqual({ source: 'system', id: 'Georgia' })
    expect(projected()).toBe(installedFor('Georgia'))
  })

  it('keeps the boot stack while an uploaded selection cannot be judged', async () => {
    document.body.style.setProperty(FONT_FAMILY_PROPERTY, presetStack('mono'))
    installFetch({ catalog: () => new Promise<Response>(() => {}) })
    const { runtime } = mount({ source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' })
    await settle()
    expect(projected()).toBe(presetStack('mono'))
    expect(runtime.getSnapshot().catalog).toBe('loading')
  })

  it('reports a failed catalogue read without touching the projected stack', async () => {
    document.body.style.setProperty(FONT_FAMILY_PROPERTY, presetStack('serif'))
    installFetch({ catalog: () => Promise.reject(new Error('connect ECONNREFUSED')) })
    // An upload selection resolves to nothing while the catalogue is unread, so
    // the boot stack is the only correct thing on screen — and a failed read
    // must leave it there rather than replacing a correct font with a guess.
    const { runtime } = mount({ source: 'upload', id: 'a.ttf' })
    await settle()
    const snapshot = runtime.getSnapshot()
    expect(snapshot.catalog).toBe('failed')
    expect(snapshot.catalogError).toBe('connect ECONNREFUSED')
    expect(projected()).toBe(presetStack('serif'))
  })

  it('reads the catalogue again on request', async () => {
    const host = installFetch()
    const { runtime } = mount()
    await settle()
    host.answer({ catalog: () => jsonResponse({ ...CATALOG, uploaded: [{ id: 'a.ttf', family: 'Alpha' }] }) })
    runtime.reloadCatalog()
    await settle()
    expect(runtime.getSnapshot().uploaded).toEqual([{ id: 'a.ttf', family: 'Alpha' }])
  })
})

describe('selecting a font', () => {
  /**
   * Build a runtime whose settings writes are refused.
   * @param message - reason the fake scope gives.
   * @returns the started runtime.
   */
  function refusing(message: string): FontRuntime {
    const scope = new FakeScope({ source: 'preset', id: 'default' })
    const refusingScope = {
      getSnapshot: () => scope.getSnapshot(),
      subscribe: (listener: () => void) => scope.subscribe(listener),
      mutate: () => Promise.reject(new Error(message)),
    } as unknown as SettingsScope<FontSettings>
    const runtime = new FontRuntime(refusingScope, new FakeTheme().asService())
    runtime.start()
    return runtime
  }

  it('reports a refused write as a saved-setting failure', async () => {
    installFetch()
    const runtime = refusing('settings: "comic" is not a shipped preset')
    await settle()
    runtime.select('preset', 'comic')
    await settle()
    expect(runtime.getSnapshot().notice).toBe('settingsFailed')
    expect(runtime.getSnapshot().noticeDetail).toContain('not a shipped preset')
  })

  it('reports a refused reset as a saved-setting failure, not a failed upload', async () => {
    installFetch()
    const runtime = refusing('settings: the document is read-only')
    await settle()
    runtime.reset()
    await settle()
    expect(runtime.getSnapshot().notice).toBe('settingsFailed')
  })

  it('writes both fields in one batch, so no intermediate state is validated', async () => {
    installFetch()
    const { runtime, scope } = mount()
    await settle()
    runtime.select('system', 'Georgia')
    await settle()
    expect(scope.batches).toEqual([[
      { op: 'set', path: ['source'], value: 'system' },
      { op: 'set', path: ['id'], value: 'Georgia' },
    ]])
  })

  it('projects a preset immediately', async () => {
    installFetch()
    const { runtime } = mount()
    await settle()
    runtime.select('preset', 'mono')
    expect(projected()).toBe(presetStack('mono'))
  })

  it('projects a system family ahead of the shared tail', async () => {
    installFetch()
    const { runtime } = mount()
    await settle()
    runtime.select('system', 'Georgia')
    expect(projected()).toBe(installedFor('Georgia'))
  })

  it('projects an uploaded family once the catalogue names it', async () => {
    installFetch({ catalog: () => jsonResponse({ ...CATALOG, uploaded: [{ id: 'a.ttf', family: 'Alpha' }] }) })
    const { runtime } = mount()
    await settle()
    runtime.select('upload', 'a.ttf')
    expect(projected()).toBe(installedFor('Alpha'))
    expect(runtime.getSnapshot().available).toBe(true)
  })

  it('reports an uploaded selection missing from a loaded catalogue as unavailable', async () => {
    installFetch()
    const { runtime } = mount()
    await settle()
    runtime.select('upload', 'gone.ttf')
    expect(runtime.getSnapshot().available).toBe(false)
    expect(projected()).toBe(presetStack('default'))
  })

  it('restores the composition default and writes no value of its own', async () => {
    installFetch()
    const { runtime, scope } = mount()
    await settle()
    runtime.select('system', 'Georgia')
    await settle()
    runtime.reset()
    await settle()
    expect(scope.batches.at(-1)).toEqual([
      { op: 'unset', path: ['source'] },
      { op: 'unset', path: ['id'] },
    ])
    expect(runtime.getSnapshot().notice).toBe('reset')
    expect(runtime.getSnapshot().selection).toEqual({ source: 'preset', id: 'default' })
  })

  it('reveals a composition base that is not the compiled default', async () => {
    installFetch()
    const { runtime } = mount({ source: 'system', id: 'Georgia' })
    await settle()
    runtime.select('preset', 'mono')
    await settle()
    runtime.reset()
    await settle()
    expect(runtime.getSnapshot().selection).toEqual({ source: 'system', id: 'Georgia' })
    expect(projected()).toBe(installedFor('Georgia'))
  })
})

describe('uploading a font', () => {
  /**
   * Build a file whose bytes the runtime only reads as an ArrayBuffer.
   * @param text - payload to stand in for font bytes.
   * @returns the file double.
   */
  function file(text = 'font bytes'): File {
    return new File([text], 'Silkscreen-Regular.ttf')
  }

  it('stores the file, selects it, and re-reads the catalogue', async () => {
    const host = installFetch({
      upload: () => jsonResponse({ id: 'silkscreen-1a2b3c4d.ttf', family: 'Silkscreen' }, 201),
      catalog: () => jsonResponse({ ...CATALOG, uploaded: [{ id: 'silkscreen-1a2b3c4d.ttf', family: 'Silkscreen' }] }),
    })
    const { runtime, scope } = mount()
    await settle()
    runtime.upload(file())
    await vi.waitFor(() => { expect(runtime.getSnapshot().busy).toBe(false) })
    await settle()

    expect(host.calls.filter(call => call.method === 'POST')).toHaveLength(1)
    expect(scope.batches.at(-1)).toEqual([
      { op: 'set', path: ['source'], value: 'upload' },
      { op: 'set', path: ['id'], value: 'silkscreen-1a2b3c4d.ttf' },
    ])
    const snapshot = runtime.getSnapshot()
    expect(snapshot.notice).toBe('uploaded')
    expect(snapshot.noticeDetail).toBe('Silkscreen')
    expect(snapshot.available).toBe(true)
    expect(projected()).toBe(installedFor('Silkscreen'))
    // The catalogue is read again, so a font the user dropped in by hand while
    // the dialog was open appears without a reload.
    expect(host.calls.filter(call => call.url.endsWith('/catalog')).length).toBeGreaterThan(1)
  })

  it('reports a refusal from the Host with its reason', async () => {
    installFetch({ upload: () => jsonResponse({ error: 'uploaded bytes are not a font' }, 400) })
    const { runtime, scope } = mount()
    await settle()
    runtime.upload(file('prose'))
    await vi.waitFor(() => { expect(runtime.getSnapshot().notice).toBe('uploadFailed') })
    expect(runtime.getSnapshot().noticeDetail).toBe('uploaded bytes are not a font')
    expect(runtime.getSnapshot().busy).toBe(false)
    // A refused upload changed nothing, so nothing was written.
    expect(scope.batches).toEqual([])
  })

  it('reports an oversized file as such rather than as a generic failure', async () => {
    installFetch({ upload: () => jsonResponse({ error: 'upload exceeds the 20971520 byte limit' }, 413) })
    const { runtime } = mount()
    await settle()
    runtime.upload(file())
    await vi.waitFor(() => { expect(runtime.getSnapshot().notice).toBe('tooLarge') })
  })
})

describe('deleting a font', () => {
  /** Catalogue holding the font every deletion case removes. */
  const WITH_UPLOAD = { ...CATALOG, uploaded: [{ id: 'a.ttf', family: 'Alpha' }] }

  it('drops the entry from the catalogue', async () => {
    installFetch({ catalog: () => jsonResponse(WITH_UPLOAD) })
    const { runtime } = mount()
    await settle()
    runtime.remove('a.ttf')
    await vi.waitFor(() => { expect(runtime.getSnapshot().uploaded).toEqual([]) })
    expect(runtime.getSnapshot().notice).toBe('removed')
  })

  it('returns to the default when the font in use is the one deleted', async () => {
    const host = installFetch({ catalog: () => jsonResponse(WITH_UPLOAD) })
    const { runtime, scope } = mount()
    await settle()
    runtime.select('upload', 'a.ttf')
    host.answer({ catalog: () => jsonResponse({ ...CATALOG, uploaded: [] }) })
    runtime.remove('a.ttf')
    await vi.waitFor(() => { expect(runtime.getSnapshot().selection.source).toBe('preset') })
    expect(scope.batches.at(-1)).toEqual([
      { op: 'unset', path: ['source'] },
      { op: 'unset', path: ['id'] },
    ])
    expect(projected()).toBe(presetStack('default'))
  })

  it('leaves an unrelated selection alone', async () => {
    installFetch({ catalog: () => jsonResponse(WITH_UPLOAD) })
    const { runtime, scope } = mount({ source: 'system', id: 'Georgia' })
    await settle()
    runtime.remove('a.ttf')
    await vi.waitFor(() => { expect(runtime.getSnapshot().notice).toBe('removed') })
    expect(runtime.getSnapshot().selection).toEqual({ source: 'system', id: 'Georgia' })
    expect(projected()).toBe(installedFor('Georgia'))
    expect(scope.batches).toEqual([])
  })

  it('reports a refusal from the Host', async () => {
    installFetch({ remove: () => jsonResponse({ error: 'no stored font named "a.ttf"' }, 404) })
    const { runtime } = mount()
    await settle()
    runtime.remove('a.ttf')
    await vi.waitFor(() => { expect(runtime.getSnapshot().notice).toBe('removeFailed') })
    expect(runtime.getSnapshot().noticeDetail).toBe('no stored font named "a.ttf"')
  })
})

describe('a Host answer that arrives after the plugin unloaded', () => {
  /**
   * Build an answer the spec releases by hand.
   * @returns the pending promise and its settlers.
   */
  function pending(): { promise: Promise<Response>; resolve: (answer: Response) => void; reject: (error: unknown) => void } {
    let resolve!: (answer: Response) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<Response>((settle, fail) => { resolve = settle; reject = fail })
    return { promise, resolve, reject }
  }

  it('ignores a stored font whose upload lands late', async () => {
    const answer = pending()
    installFetch({ upload: () => answer.promise })
    const { runtime, scope } = mount()
    await settle()
    runtime.upload(new File(['font bytes'], 'late.ttf'))
    runtime.dispose()
    answer.resolve(jsonResponse({ id: 'late.ttf', family: 'Late' }, 201))
    await settle()
    // Nothing is written and nothing is declared for a plugin that is gone.
    expect(scope.batches).toEqual([])
    expect(faceBlock()).toBeNull()
  })

  it('ignores a refused upload whose refusal lands late', async () => {
    const answer = pending()
    installFetch({ upload: () => answer.promise })
    const { runtime } = mount()
    await settle()
    runtime.upload(new File(['font bytes'], 'late.ttf'))
    const seq = runtime.getSnapshot().seq
    runtime.dispose()
    answer.reject(new Error('too late'))
    await settle()
    expect(runtime.getSnapshot().seq).toBe(seq)
  })

  it('ignores a deletion whose answer lands late', async () => {
    const answer = pending()
    installFetch({ remove: () => answer.promise })
    const { runtime, scope } = mount({ source: 'upload', id: 'a.ttf' })
    await settle()
    runtime.remove('a.ttf')
    runtime.dispose()
    answer.resolve(jsonResponse(undefined, 204))
    await settle()
    // The selection is left as the document holds it; a late deletion must not
    // clear a choice the next page load will resolve again anyway.
    expect(scope.batches).toEqual([])
  })

  it('ignores a refused deletion whose refusal lands late', async () => {
    const answer = pending()
    installFetch({ remove: () => answer.promise })
    const { runtime } = mount({ source: 'upload', id: 'a.ttf' })
    await settle()
    runtime.remove('a.ttf')
    const seq = runtime.getSnapshot().seq
    runtime.dispose()
    answer.reject(new Error('too late'))
    await settle()
    expect(runtime.getSnapshot().seq).toBe(seq)
  })
})

describe('a failure that is not an Error', () => {
  it('reports a settings write that rejected without one', async () => {
    installFetch()
    const scope = new FakeScope({ source: 'preset', id: 'default' })
    const refusingScope = {
      getSnapshot: () => scope.getSnapshot(),
      subscribe: (listener: () => void) => scope.subscribe(listener),
      mutate: () => Promise.reject('write offline'),
    } as unknown as SettingsScope<FontSettings>
    const runtime = new FontRuntime(refusingScope, new FakeTheme().asService())
    runtime.start()
    await settle()
    runtime.select('preset', 'serif')
    await settle()
    expect(runtime.getSnapshot().notice).toBe('settingsFailed')
    expect(runtime.getSnapshot().noticeDetail).toBe('write offline')
  })
})

describe('the declarations the browser installs', () => {
  /** Catalogue holding one stored font. */
  const STORED = { ...CATALOG, uploaded: [{ id: 'alpha-1a2b3c4d.ttf', family: 'Alpha' }] }

  it('declares a stored font, so naming its family can paint it', async () => {
    installFetch({ catalog: () => jsonResponse(STORED) })
    mount()
    await settle()
    const css = faceBlock()?.textContent ?? ''
    expect(css).toContain('font-family:Alpha')
    expect(css).toContain('/api/ui-font-family/fonts/alpha-1a2b3c4d.ttf')
  })

  it('declares a font uploaded during this session', async () => {
    const stored = { id: 'alpha-1a2b3c4d.ttf', family: 'Alpha' }
    let catalogue: { id: string; family: string }[] = []
    installFetch({
      // The Host writes the file before it answers, so the read that follows an
      // upload already lists it — the same order the real routes have.
      catalog: () => jsonResponse({ ...CATALOG, uploaded: catalogue }),
      upload: () => {
        catalogue = [stored]
        return jsonResponse(stored, 201)
      },
    })
    const { runtime } = mount()
    await settle()
    expect(faceBlock()).toBeNull()
    runtime.upload(new File(['font bytes'], 'Alpha.ttf'))
    await vi.waitFor(() => { expect(faceBlock()?.textContent).toContain('font-family:Alpha') })
  })

  it('stops declaring a font once it is deleted', async () => {
    const host = installFetch({ catalog: () => jsonResponse(STORED) })
    const { runtime } = mount()
    await settle()
    host.answer({ catalog: () => jsonResponse(CATALOG) })
    runtime.remove('alpha-1a2b3c4d.ttf')
    await vi.waitFor(() => { expect(faceBlock()?.textContent).toBe('') })
  })

  it('leaves the block the Host rendered alone until the catalogue is read', async () => {
    const rendered = document.createElement('style')
    rendered.id = FONT_FACE_STYLE_ID
    rendered.textContent = '@font-face{font-family:Boot;src:url("/host/boot.ttf")}'
    document.head.append(rendered)
    installFetch({ catalog: () => new Promise<Response>(() => {}) })
    mount({ source: 'upload', id: 'boot.ttf' })
    await settle()
    // Clearing the Host's rules here would take the only source of the font
    // already in use off the page.
    expect(rendered.textContent).toContain('Boot')
    expect(faceBlock()).toBe(rendered)
  })

  it('retracts the declarations when the plugin unloads', async () => {
    installFetch({ catalog: () => jsonResponse(STORED) })
    const { runtime } = mount()
    await settle()
    expect(faceBlock()).not.toBeNull()
    runtime.dispose()
    expect(faceBlock()).toBeNull()
  })
})

describe('the published snapshot', () => {
  it('notifies a subscribed listener after each change', async () => {
    installFetch()
    const { runtime } = mount()
    await settle()
    const listener = vi.fn()
    const stop = runtime.subscribe(listener)
    const before = runtime.getSnapshot().seq
    runtime.select('preset', 'serif')
    expect(listener).toHaveBeenCalled()
    expect(runtime.getSnapshot().seq).toBeGreaterThan(before)
    stop()
    runtime.dispose()
  })

  it('keeps its selection while the scope has not resolved a value', async () => {
    installFetch()
    const scope = new FakeScope({ source: 'preset', id: 'default' })
    // `value` is undefined until the Host's first view is accepted, which is
    // the state of the very first frame.
    const loading = {
      getSnapshot: () => ({ ...scope.getSnapshot(), status: 'loading' as const, value: undefined }),
      subscribe: (listener: () => void) => scope.subscribe(listener),
      mutate: () => Promise.resolve(),
    } as unknown as SettingsScope<FontSettings>
    const runtime = new FontRuntime(loading, new FakeTheme().asService())
    runtime.start()
    await settle()
    expect(runtime.getSnapshot().selection).toEqual({ source: 'preset', id: 'default' })
    runtime.dispose()
  })

  it('adopts a value the scope publishes later', async () => {
    installFetch()
    const scope = new FakeScope({ source: 'preset', id: 'default' })
    let value: FontSettings | undefined
    const late = {
      getSnapshot: () => ({ ...scope.getSnapshot(), value }),
      subscribe: (listener: () => void) => scope.subscribe(listener),
      mutate: () => Promise.resolve(),
    } as unknown as SettingsScope<FontSettings>
    const runtime = new FontRuntime(late, new FakeTheme().asService())
    runtime.start()
    await settle()
    value = { source: 'system', id: 'Georgia' }
    scope.notify()
    expect(runtime.getSnapshot().selection).toEqual({ source: 'system', id: 'Georgia' })
    runtime.dispose()
  })

  it('stays quiet when a settings write is refused after the plugin unloaded', async () => {
    installFetch()
    const scope = new FakeScope({ source: 'preset', id: 'default' })
    let refuse!: (error: unknown) => void
    // A write the Host answers only after the plugin is gone: the rejection
    // arrives with nothing left to report it to.
    const slow = {
      getSnapshot: () => scope.getSnapshot(),
      subscribe: (listener: () => void) => scope.subscribe(listener),
      mutate: () => new Promise<void>((_resolve, reject) => { refuse = reject }),
    } as unknown as SettingsScope<FontSettings>
    const runtime = new FontRuntime(slow, new FakeTheme().asService())
    runtime.start()
    await settle()

    runtime.select('system', 'Georgia')
    runtime.dispose()
    refuse(new Error('settings: the write was refused'))
    await settle()

    expect(runtime.getSnapshot().notice).toBe('')
  })

  it('keeps one reference until something changes', async () => {
    installFetch()
    const { runtime } = mount()
    await settle()
    const snapshot = runtime.getSnapshot()
    expect(runtime.getSnapshot()).toBe(snapshot)
  })

  it('advances its sequence on every publish', async () => {
    installFetch()
    const { runtime } = mount()
    await settle()
    const before = runtime.getSnapshot().seq
    runtime.select('preset', 'sans')
    expect(runtime.getSnapshot().seq).toBeGreaterThan(before)
  })

  it('stops notifying a listener that unsubscribed', async () => {
    installFetch()
    const scope = new FakeScope({ source: 'preset', id: 'default' })
    const runtime = new FontRuntime(scope.asScope(), new FakeTheme().asService())
    const stopHost = runtime.start()
    const listener = vi.fn()
    const stop = runtime.subscribe(listener)
    stop()
    runtime.select('preset', 'serif')
    expect(listener).not.toHaveBeenCalled()
    stopHost()
    runtime.dispose()
  })

  it('retracts the projected stack when the plugin unloads', async () => {
    installFetch()
    const { runtime } = mount({ source: 'system', id: 'Georgia' })
    await settle()
    expect(projected()).toBe(installedFor('Georgia'))
    runtime.dispose()
    expect(projected()).toBe('')
  })

  it('publishes nothing after disposal', async () => {
    installFetch({ catalog: () => Promise.reject(new Error('late failure')) })
    const { runtime } = mount()
    runtime.dispose()
    const seq = runtime.getSnapshot().seq
    await settle()
    expect(runtime.getSnapshot().seq).toBe(seq)
  })
})
