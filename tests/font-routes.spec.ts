import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  FONT_API_PREFIX,
  FONT_CATALOG_ROUTE,
  FONT_COLLECTION_ROUTE,
  type FontCatalogResponse,
  type FontErrorResponse,
  type FontUploadSummary,
} from '../src/font-api.ts'
import { isLocalPeer, localHostAddresses, registerFontRoutes, type FontRouteDeps } from '../src/font-routes.ts'
import { SystemFontIndex } from '../src/system-fonts.ts'
import { UserFontDirectory } from '../src/user-fonts.ts'

/** OFL-licensed fixture whose name table declares the family "Silkscreen". */
const FIXTURE = fileURLToPath(new URL('./fixtures/Silkscreen-Regular.ttf', import.meta.url))

/** An address no interface of the test host carries. */
const FOREIGN_PEER = '203.0.113.9'

/** One route as the fake web server recorded it. */
interface RecordedRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** A response double that records what a handler wrote. */
interface RecordedResponse {
  status: number
  headers: Record<string, string>
  body: Buffer
  /**
   * Answer one request through this response.
   * @param route - route to call.
   * @param req - request to pass.
   */
  send: (route: RecordedRoute, req: IncomingMessage) => Promise<void>
}

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Build a request double readable as a stream, the way the handlers consume it.
 * @param method - HTTP method.
 * @param url - request target.
 * @param options - body bytes and the peer address Node would report.
 * @returns the request double.
 */
function makeRequest(
  method: string,
  url: string,
  options: { body?: Buffer; peer?: string; contentLength?: number } = {},
): IncomingMessage {
  const body = options.body
  const stream = Readable.from(body === undefined ? [] : [body])
  const declared = options.contentLength ?? body?.length
  return Object.assign(stream, {
    method,
    url,
    headers: declared === undefined ? {} : { 'content-length': String(declared) },
    socket: { remoteAddress: options.peer ?? '127.0.0.1' },
  }) as unknown as IncomingMessage
}

/**
 * Build a response double.
 * @returns the response and a helper that runs one request through it.
 */
function makeResponse(): RecordedResponse {
  const recorded = {
    status: 0,
    headers: {} as Record<string, string>,
    body: Buffer.alloc(0),
    async send(route: RecordedRoute, req: IncomingMessage): Promise<void> {
      const chunks: Buffer[] = []
      const res = {
        writeHead(status: number, headers?: Record<string, string | number>) {
          recorded.status = status
          recorded.headers = Object.fromEntries(
            Object.entries(headers ?? {}).map(([key, value]) => [key, String(value)]),
          )
          return res
        },
        end(chunk?: Buffer | string) {
          if (chunk !== undefined) chunks.push(Buffer.from(chunk))
          recorded.body = Buffer.concat(chunks)
          return res
        },
      } as unknown as ServerResponse
      await route.handler(req, res)
    },
  }
  return recorded
}

/** A context double recording route registrations as disposables. */
interface TestHost {
  ctx: Context
  routes: RecordedRoute[]
  dispose: () => void
}

/**
 * Build a context whose web server records registrations and whose effects
 * can be disposed, so the HMR-safety behaviour is observable.
 * @returns the context double.
 */
function makeHost(): TestHost {
  const routes: RecordedRoute[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    webServer: {
      register(route: RecordedRoute) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index !== -1) routes.splice(index, 1)
        }
      },
    },
    effect(callback: () => unknown) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return disposer
    },
  } as unknown as Context
  return {
    ctx,
    routes,
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

/** One registered route together with the state a test asserts against. */
interface Fixture {
  host: TestHost
  catalog: RecordedRoute
  collection: RecordedRoute
  userFonts: UserFontDirectory
  fontDir: string
  onCatalogChanged: ReturnType<typeof vi.fn>
}

/**
 * Register the routes over a temporary user font directory.
 * @param options - whether to install a system font index and the upload limit.
 * @returns the recorded routes and the directory backing them.
 */
async function register(options: { systemFonts?: boolean; maxUploadBytes?: number } = {}): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-font-routes-'))
  directories.push(parent)
  const fontDir = join(parent, 'fonts')
  const onCatalogChanged = vi.fn()
  const userFonts = new UserFontDirectory(fontDir, { warn: vi.fn() })
  const deps: FontRouteDeps = {
    userFonts,
    systemFonts: options.systemFonts === true ? new SystemFontIndex([fontDir], { warn: vi.fn() }) : undefined,
    maxUploadBytes: options.maxUploadBytes ?? 1024 * 1024,
    onCatalogChanged,
  }
  const host = makeHost()
  registerFontRoutes(host.ctx, deps)
  const catalog = host.routes.find(route => route.path === FONT_CATALOG_ROUTE)
  const collection = host.routes.find(route => route.path === FONT_COLLECTION_ROUTE)
  if (catalog === undefined || collection === undefined) throw new Error('routes were not registered')
  return { host, catalog, collection, userFonts, fontDir, onCatalogChanged }
}

/**
 * Read one JSON response body.
 * @param response - response double holding the bytes.
 * @returns the parsed body.
 */
function json<T>(response: RecordedResponse): T {
  return JSON.parse(response.body.toString('utf8')) as T
}

/**
 * Store the font fixture and return its bytes.
 * @returns the fixture's file contents.
 */
async function fixture(): Promise<Buffer> {
  return readFile(FIXTURE)
}

describe('route paths', () => {
  it('lives under this plugin own prefix', () => {
    expect(FONT_API_PREFIX).toBe('/api/ui-font-family')
    expect(FONT_CATALOG_ROUTE).toBe(`${FONT_API_PREFIX}/catalog`)
    expect(FONT_COLLECTION_ROUTE).toBe(`${FONT_API_PREFIX}/fonts`)
  })
})

describe('isLocalPeer', () => {
  it('accepts loopback in either spelling', () => {
    const local = localHostAddresses()
    expect(isLocalPeer('127.0.0.1', local)).toBe(true)
    expect(isLocalPeer('::1', local)).toBe(true)
    expect(isLocalPeer('::ffff:127.0.0.1', local)).toBe(true)
  })

  it('accepts this host own interface addresses', () => {
    const local = localHostAddresses()
    for (const address of local) {
      expect(isLocalPeer(address, local)).toBe(true)
      expect(isLocalPeer(`::ffff:${address}`, local)).toBe(true)
    }
  })

  it('ignores an IPv6 zone suffix', () => {
    expect(isLocalPeer('::1%lo0', new Set(['::1']))).toBe(true)
  })

  it('rejects a peer on another machine', () => {
    expect(isLocalPeer(FOREIGN_PEER, localHostAddresses())).toBe(false)
    expect(isLocalPeer(undefined, localHostAddresses())).toBe(false)
  })
})

describe('the catalogue route', () => {
  it('reports the storage directory and the uploaded catalogue', async () => {
    const fixtureHost = await register()
    await fixtureHost.userFonts.save(await fixture())
    const response = makeResponse()
    await response.send(fixtureHost.catalog, makeRequest('GET', FONT_CATALOG_ROUTE))
    expect(response.status).toBe(200)
    const body = json<FontCatalogResponse>(response)
    expect(body.fontDir).toBe(fixtureHost.fontDir)
    expect(body.uploaded).toHaveLength(1)
    expect(body.uploaded[0]?.family).toBe('Silkscreen')
  })

  it('withholds the installed fonts from a peer on another machine', async () => {
    const fixtureHost = await register({ systemFonts: true })
    const response = makeResponse()
    await response.send(fixtureHost.catalog, makeRequest('GET', FONT_CATALOG_ROUTE, { peer: FOREIGN_PEER }))
    const body = json<FontCatalogResponse>(response)
    expect(body.system).toBeNull()
    expect(body.systemUnavailable).toBe('remote')
  })

  it('still lists and serves the fonts this plugin stored to a peer on another machine', async () => {
    // Only the installed-font list is restricted: it describes the machine the
    // Host runs on. What the user uploaded through this plugin is theirs, and a
    // browser that is not the Host is exactly who asked for it.
    const fixtureHost = await register({ systemFonts: true })
    const stored = await fixtureHost.userFonts.save(await fixture())
    const catalog = makeResponse()
    await catalog.send(fixtureHost.catalog, makeRequest('GET', FONT_CATALOG_ROUTE, { peer: FOREIGN_PEER }))
    expect(json<FontCatalogResponse>(catalog).uploaded).toEqual([stored])

    const download = makeResponse()
    await download.send(fixtureHost.collection, makeRequest(
      'GET',
      `${FONT_COLLECTION_ROUTE}/${stored.id}`,
      { peer: FOREIGN_PEER },
    ))
    expect(download.status).toBe(200)
    expect(download.body).toEqual(await fixture())
  })

  it('serves the installed fonts to a request from this machine', async () => {
    const fixtureHost = await register({ systemFonts: true })
    await fixtureHost.userFonts.save(await fixture())
    const response = makeResponse()
    await response.send(fixtureHost.catalog, makeRequest('GET', FONT_CATALOG_ROUTE))
    expect(json<FontCatalogResponse>(response).system).toEqual(['Silkscreen'])
  })

  it('names a disabled scan as the reason rather than blaming the caller', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.catalog, makeRequest('GET', FONT_CATALOG_ROUTE))
    const body = json<FontCatalogResponse>(response)
    expect(body.system).toBeNull()
    expect(body.systemUnavailable).toBe('disabled')
  })

  it('refuses a method it does not answer', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.catalog, makeRequest('POST', FONT_CATALOG_ROUTE, { body: Buffer.from('x') }))
    expect(response.status).toBe(405)
  })
})

describe('uploading a font', () => {
  it('accepts an upload from a browser that is not the Host', async () => {
    // Only the installed-font list is restricted to this machine. Upload and
    // deletion are open, so a browser elsewhere on the network can manage the
    // fonts it is going to render.
    const fixtureHost = await register({ systemFonts: true })
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('POST', FONT_COLLECTION_ROUTE, {
      body: await fixture(),
      peer: FOREIGN_PEER,
    }))
    expect(response.status).toBe(201)
    expect(json<FontUploadSummary>(response).family).toBe('Silkscreen')

    const removal = makeResponse()
    await removal.send(fixtureHost.collection, makeRequest(
      'DELETE',
      `${FONT_COLLECTION_ROUTE}/${json<FontUploadSummary>(response).id}`,
      { peer: FOREIGN_PEER },
    ))
    expect(removal.status).toBe(204)
  })

  it('stores the bytes and reports the entry it created', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('POST', FONT_COLLECTION_ROUTE, { body: await fixture() }))
    expect(response.status).toBe(201)
    const stored = json<{ id: string; family: string }>(response)
    expect(stored.family).toBe('Silkscreen')
    await expect(readdir(fixtureHost.fontDir)).resolves.toEqual([stored.id])
    expect(fixtureHost.onCatalogChanged).toHaveBeenCalledTimes(1)
  })

  it('refuses bytes that are not a font and reports why', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('POST', FONT_COLLECTION_ROUTE, { body: Buffer.from('prose') }))
    expect(response.status).toBe(400)
    expect(json<FontErrorResponse>(response).error).toMatch(/not a TrueType/)
    // A rejected upload changed nothing, so nothing is announced.
    expect(fixtureHost.onCatalogChanged).not.toHaveBeenCalled()
  })

  it('reports a storage failure as a server error rather than blaming the bytes', async () => {
    const fixtureHost = await register()
    // A real font, but nowhere to put it: the path that should be the font
    // directory is a file, so the write fails for a reason the caller did not
    // cause and a 400 would send them looking at their font file.
    await writeFile(fixtureHost.fontDir, 'not a directory')
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('POST', FONT_COLLECTION_ROUTE, { body: await fixture() }))
    expect(response.status).toBe(500)
    expect(json<FontErrorResponse>(response).error).toMatch(/could not store the uploaded font/)
    expect(fixtureHost.onCatalogChanged).not.toHaveBeenCalled()
  })

  it('refuses an oversized body before reading it', async () => {
    const fixtureHost = await register({ maxUploadBytes: 16 })
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('POST', FONT_COLLECTION_ROUTE, { body: await fixture() }))
    expect(response.status).toBe(413)
    expect(fixtureHost.onCatalogChanged).not.toHaveBeenCalled()
  })

  it('refuses an oversized body that arrives without a declared length', async () => {
    const fixtureHost = await register({ maxUploadBytes: 16 })
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('POST', FONT_COLLECTION_ROUTE, {
      body: await fixture(),
      contentLength: 0,
    }))
    expect(response.status).toBe(413)
  })

  it('refuses a method it does not answer', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('PUT', FONT_COLLECTION_ROUTE))
    expect(response.status).toBe(405)
  })
})

describe('serving a stored font', () => {
  it('returns the bytes with the media type the bytes themselves name', async () => {
    const fixtureHost = await register()
    const stored = await fixtureHost.userFonts.save(await fixture())
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('GET', `${FONT_COLLECTION_ROUTE}/${stored.id}`))
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('font/ttf')
    expect(response.body).toEqual(await fixture())
  })

  it('reports an unknown font as absent', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('GET', `${FONT_COLLECTION_ROUTE}/missing-12345678.ttf`))
    expect(response.status).toBe(404)
  })

  it('refuses a percent-encoded traversal instead of reading outside the directory', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    // The path segment decodes to `../../settings.yaml`, which is not an id
    // this directory owns; the handler must answer 404 without touching it.
    await response.send(fixtureHost.collection, makeRequest('GET', `${FONT_COLLECTION_ROUTE}/..%2F..%2Fsettings.yaml`))
    expect(response.status).toBe(404)
  })

  it('refuses a malformed escape', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('GET', `${FONT_COLLECTION_ROUTE}/%E0%A4%A.ttf`))
    expect(response.status).toBe(404)
  })
})

describe('deleting a stored font', () => {
  it('removes the file and answers with no body', async () => {
    const fixtureHost = await register()
    const stored = await fixtureHost.userFonts.save(await fixture())
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('DELETE', `${FONT_COLLECTION_ROUTE}/${stored.id}`))
    expect(response.status).toBe(204)
    expect(response.body).toHaveLength(0)
    await expect(readdir(fixtureHost.fontDir)).resolves.toEqual([])
    expect(fixtureHost.onCatalogChanged).toHaveBeenCalledTimes(1)
  })

  it('reports an unknown font as absent and announces nothing', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('DELETE', `${FONT_COLLECTION_ROUTE}/missing-12345678.ttf`))
    expect(response.status).toBe(404)
    expect(fixtureHost.onCatalogChanged).not.toHaveBeenCalled()
  })

  it('refuses an encoded traversal', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('DELETE', `${FONT_COLLECTION_ROUTE}/..%2F..%2Fsettings.yaml`))
    expect(response.status).toBe(404)
  })

  it('refuses a method it does not answer', async () => {
    const fixtureHost = await register()
    const response = makeResponse()
    await response.send(fixtureHost.collection, makeRequest('PATCH', `${FONT_COLLECTION_ROUTE}/a.ttf`))
    expect(response.status).toBe(405)
  })
})

describe('route ownership', () => {
  it('registers one exact catalogue route and one collection prefix', async () => {
    const fixtureHost = await register()
    expect(fixtureHost.host.routes.map(route => [route.kind, route.path])).toEqual([
      ['exact', FONT_CATALOG_ROUTE],
      ['prefix', FONT_COLLECTION_ROUTE],
    ])
  })

  it('stops answering once its owning context is disposed', async () => {
    const fixtureHost = await register()
    fixtureHost.host.dispose()
    expect(fixtureHost.host.routes).toEqual([])
  })
})
