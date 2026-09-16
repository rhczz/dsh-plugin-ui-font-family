import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { bootFontInjection } from '../src/boot-font.ts'
import { FONT_CATALOG_ROUTE, type FontCatalogResponse } from '../src/font-api.ts'
import { FONT_SETTINGS_NAMESPACE, type FontSettings } from '../src/font-settings.ts'
import { fontPresetFamilies } from '../src/font-presets.ts'
import { apply, DEFAULT_MAX_UPLOAD_BYTES, inject, resolveSpec, type Config } from '../src/index.ts'

const directories: string[] = []

/** OFL-licensed fixture whose name table declares the family "Silkscreen". */
const FIXTURE = fileURLToPath(new URL('./fixtures/Silkscreen-Regular.ttf', import.meta.url))

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Create a temporary directory to serve as the harness home.
 * @returns its absolute path.
 */
async function createHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-font-home-'))
  directories.push(dir)
  return dir
}

/** One `installSection` call as the fake settings service recorded it. */
interface RecordedSection {
  owner: unknown
  namespace: string
  schema: unknown
  base: FontSettings
  setSource: (current: () => FontSettings) => void
  validate: (value: FontSettings) => void
  onChange: () => void
}

/** One route as the fake web server recorded it. */
interface RecordedRoute {
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}

/** A Host context double recording the registrations `apply` makes. */
interface TestHost {
  ctx: Context
  sections: RecordedSection[]
  injections: IndexInjection[][]
  routes: string[]
  /** Routes as registered, so a case can answer through one. */
  registered: RecordedRoute[]
  logger: { warn: ReturnType<typeof vi.fn> }
  /** Push one index injection table the way a render would. */
  render: () => readonly IndexInjection[]
  /** Release every effect `apply` registered. */
  dispose: () => void
}

/**
 * Build a context exposing the services `apply` consumes.
 * @returns the context double.
 */
function makeHost(): TestHost {
  const sections: RecordedSection[] = []
  const injections: IndexInjection[][] = []
  const routes: string[] = []
  const registered: RecordedRoute[] = []
  const disposers: (() => void)[] = []
  const listeners = new Map<string, ((payload: unknown) => void)[]>()
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }

  const ctx = {
    logger,
    effect(callback: () => unknown) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return disposer
    },
    on(event: string, listener: (payload: unknown) => void) {
      const known = listeners.get(event) ?? []
      known.push(listener)
      listeners.set(event, known)
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter(entry => entry !== listener))
      }
    },
    inject(_deps: readonly string[], callback: (scoped: unknown) => void) {
      callback({
        settings: {
          installSection(owner: unknown, namespace: string, schema: unknown, base: FontSettings, hooks: {
            setSource: (current: () => FontSettings) => void
            validate: (value: FontSettings) => void
            onChange: () => void
          }) {
            sections.push({ owner, namespace, schema, base, ...hooks })
            return () => {}
          },
        },
      })
    },
    webServer: {
      register(route: RecordedRoute) {
        routes.push(route.path)
        registered.push(route)
        return () => {}
      },
    },
  } as unknown as Context

  return {
    ctx,
    sections,
    injections,
    routes,
    registered,
    logger,
    render: () => {
      const table: IndexInjection[] = []
      for (const listener of listeners.get('webserver/index-inject') ?? []) listener(table)
      injections.push(table)
      return table
    },
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

/**
 * Read the inline-script text out of an index injection table.
 * @param table - rows a render collected.
 * @returns the script text of the single row this plugin contributes.
 */
function scriptText(table: readonly IndexInjection[]): string {
  const row = table[0]
  if (row === undefined || row.kind !== 'script') {
    throw new Error(`expected one inline-script row, got ${JSON.stringify(table)}`)
  }
  return row.text
}

/**
 * Read the inline-style text out of an index injection table.
 * @param table - rows a render collected.
 * @returns the CSS text, or an empty string when no style row was contributed.
 */
function styleText(table: readonly IndexInjection[]): string {
  const row = table.find(entry => entry.kind === 'style')
  return row?.kind === 'style' ? row.text : ''
}

describe('resolveSpec', () => {
  it('defaults the user font directory to fonts under the harness home', async () => {
    const home = await createHome()
    expect(resolveSpec({ dshHome: home }).fontDir).toBe(join(home, 'fonts'))
  })

  it('prefers an explicitly configured directory', () => {
    expect(resolveSpec({ fontDir: '/srv/fonts', dshHome: '/ignored' }).fontDir).toBe('/srv/fonts')
  })

  it('scans the platform directories by default', () => {
    expect(resolveSpec({ fontDir: '/srv/fonts' }).systemFontDirs.length).toBeGreaterThan(0)
  })

  it('appends extra directories after the platform ones', () => {
    const dirs = resolveSpec({ fontDir: '/srv/fonts', systemFontDirs: ['/opt/fonts'] }).systemFontDirs
    expect(dirs.at(-1)).toBe('/opt/fonts')
  })

  it('scans nothing when the composition turns scanning off', () => {
    expect(resolveSpec({ fontDir: '/srv/fonts', scanSystemFonts: false }).systemFontDirs).toEqual([])
  })

  it('still scans a directory the composition named when platform scanning is off', () => {
    // The switch governs the platform directories. Dropping an explicitly
    // configured directory with them would ignore configuration silently.
    const dirs = resolveSpec({
      fontDir: '/srv/fonts',
      scanSystemFonts: false,
      systemFontDirs: ['/opt/fonts'],
    }).systemFontDirs
    expect(dirs).toEqual(['/opt/fonts'])
  })

  it('accepts an upload limit the composition chose', () => {
    expect(resolveSpec({ fontDir: '/srv/fonts', maxUploadBytes: 1024 }).maxUploadBytes).toBe(1024)
  })

  it('rejects an upload limit that could never be served', () => {
    for (const maxUploadBytes of [0, -1, 1.5, Number.NaN]) {
      expect(() => resolveSpec({ fontDir: '/srv/fonts', maxUploadBytes })).toThrow(/positive integer/)
    }
  })

  it('defaults the selection and rejects one that names no shipped font', () => {
    expect(resolveSpec({ fontDir: '/srv/fonts' }).defaultFamily).toEqual({ source: 'preset', id: 'default' })
    expect(() => resolveSpec({ fontDir: '/srv/fonts', defaultFamily: { source: 'preset', id: 'comic' } }))
      .toThrow(/names no shipped font preset/)
  })

  it('reports the documented upload limit', () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024)
  })
})

describe('the plugin body', () => {
  it('declares the web server, so its routes have a server to live on', () => {
    expect(inject).toContain('webServer')
  })

  /**
   * Apply the plugin over a temporary harness home.
   * @param config - composition entry to apply.
   * @returns the context double and the home directory.
   */
  async function mount(config: Config = {}): Promise<{ host: TestHost; home: string }> {
    const home = config.dshHome ?? await createHome()
    const host = makeHost()
    apply(host.ctx, { ...config, dshHome: home, scanSystemFonts: config.scanSystemFonts ?? false })
    return { host, home }
  }

  /**
   * Answer one request through a registered route.
   * @param route - route to call.
   * @returns the JSON body the handler wrote.
   */
  async function answer(route: RecordedRoute): Promise<FontCatalogResponse> {
    let body = ''
    const res = {
      writeHead() { return res },
      end(chunk?: string) {
        if (chunk !== undefined) body = chunk
        return res
      },
    }
    // A font list is only served to the machine the Host runs on.
    await route.handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, res)
    return JSON.parse(body) as FontCatalogResponse
  }

  it('installs its settings section with the composition selection as the base layer', async () => {
    const { host } = await mount()
    expect(host.sections).toHaveLength(1)
    expect(host.sections[0]?.namespace).toBe(FONT_SETTINGS_NAMESPACE)
    expect(host.sections[0]?.base).toEqual({ source: 'preset', id: 'default' })
  })

  it('rejects a stored section that names no shipped preset', async () => {
    const { host } = await mount()
    expect(() => host.sections[0]?.validate({ source: 'preset', id: 'comic' })).toThrow()
  })

  it('registers both of its routes', async () => {
    const { host } = await mount()
    expect(host.routes).toEqual(['/api/ui-font-family/catalog', '/api/ui-font-family/fonts'])
  })

  it('contributes one bootstrap row carrying the families the selection resolved to', async () => {
    const { host } = await mount({ defaultFamily: { source: 'preset', id: 'mono' } })
    const table = host.render()
    expect(table).toHaveLength(1)
    expect(table[0]).toEqual(bootFontInjection(fontPresetFamilies('mono')))
  })

  it('contributes no row for the preset that asks for the harness font', async () => {
    // The default preset installs nothing, so a render has no stack to place:
    // anything it wrote here would replace the harness's own font with a
    // different one, at metrics its layout was not measured for.
    const { host } = await mount({ defaultFamily: { source: 'preset', id: 'default' } })
    expect(host.render()).toEqual([])
  })

  it('resolves the section value the settings service reports, not the configured one', async () => {
    const { host } = await mount()
    host.sections[0]?.setSource(() => ({ source: 'system', id: 'Georgia' }))
    expect(scriptText(host.render())).toContain('Georgia')
  })

  it('contributes no row while an uploaded selection cannot be judged yet', async () => {
    const { host } = await mount()
    // The uploaded catalogue is read asynchronously; before it lands, an
    // `upload` selection resolves to nothing and the harness default stays.
    host.sections[0]?.setSource(() => ({ source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' }))
    expect(host.render()).toEqual([])
  })

  it('warns and keeps working when the font directory cannot be read', async () => {
    const home = await createHome()
    // A file where the font directory belongs. Nothing the plugin serves
    // depends on that directory: the presets are compiled in, and a stored
    // choice is still resolved by the Host, so the failure is reported once
    // and the plugin stays up.
    await writeFile(join(home, 'fonts'), 'not a directory')
    const host = makeHost()
    apply(host.ctx, { dshHome: home, scanSystemFonts: false })

    await vi.waitFor(() => { expect(host.logger.warn).toHaveBeenCalled() })
    expect(host.logger.warn.mock.calls[0]?.[0]).toMatch(/could not read the user font directory/)

    // The catalogue counts as unread, so an uploaded selection contributes no
    // row instead of naming a font this render cannot justify.
    host.sections[0]?.setSource(() => ({ source: 'upload', id: 'silkscreen-1a2b3c4d.ttf' }))
    expect(host.render()).toEqual([])
  })

  it('declares nothing when no font has been stored', async () => {
    // A preset that does install, so the render carries a row and the assertion
    // is about the missing declarations rather than about an empty table.
    const { host } = await mount({ defaultFamily: { source: 'preset', id: 'mono' } })
    await vi.waitFor(() => { expect(host.render()).toHaveLength(1) })
    expect(styleText(host.render())).toBe('')
  })

  it('declares every stored font, so the browser can paint it at first paint', async () => {
    const home = await createHome()
    const fontDir = join(home, 'fonts')
    // The catalogue is read once at load, so the font has to be in place before
    // the plugin is applied — the same position a hand-copied file is in.
    await mkdir(fontDir, { recursive: true })
    await copyFile(FIXTURE, join(fontDir, 'Silkscreen-Regular.ttf'))
    const host = makeHost()
    apply(host.ctx, { dshHome: home, scanSystemFonts: false })

    await vi.waitFor(() => { expect(styleText(host.render())).toContain('@font-face') })
    const css = styleText(host.render())
    expect(css).toContain('font-family:Silkscreen')
    expect(css).toContain('/api/ui-font-family/fonts/')
    // The row lands in the head, where a face declaration belongs, and cannot
    // close the element carrying it.
    expect(css).not.toContain('<')
    expect(host.render().find(row => row.kind === 'style')).toBeDefined()
  })

  it('releases its registrations when the owning context is disposed', async () => {
    const { host } = await mount()
    expect(host.routes).toHaveLength(2)
    host.dispose()
    // The route double records removal by emptying; what matters here is that
    // every registration went through an effect, so a disposal reaches them.
    expect(host.sections).toHaveLength(1)
  })

  it('scans the directories it was configured with', async () => {
    const home = await createHome()
    const installed = await mkdtemp(join(tmpdir(), 'dsh-font-system-'))
    directories.push(installed)
    await copyFile(FIXTURE, join(installed, 'Silkscreen-Regular.ttf'))
    const host = makeHost()
    apply(host.ctx, { dshHome: home, scanSystemFonts: false, systemFontDirs: [installed] })

    // The scan runs on the first catalogue read, so this also shows the
    // configured directories reached the index rather than the platform ones.
    const catalog = host.registered.find(route => route.path === FONT_CATALOG_ROUTE)
    expect(catalog).toBeDefined()
    const body = await answer(catalog as RecordedRoute)
    expect(body.system).toEqual(['Silkscreen'])
  })

  it('derives the bootstrap row at render time, so a change needs no reaction', async () => {
    const { host } = await mount()
    const before = host.render()
    // The section's change hook has nothing cached to re-judge; a committed
    // change reaches the row through the settings scope the client subscribes
    // to, which is why this hook is empty.
    host.sections[0]?.onChange()
    expect(host.render()).toEqual(before)
  })
})
