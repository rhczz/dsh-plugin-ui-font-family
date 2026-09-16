// @vitest-environment jsdom
/**
 * The browser's access to the Host font routes: which URL and method each call
 * uses, how a refusal becomes an error the row can show, and the two ways a
 * request can fail without the Host ever answering.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FONT_CATALOG_ROUTE, FONT_COLLECTION_ROUTE } from '../../src/font-api.ts'
import {
  deleteFontFile,
  EMPTY_FONT_CATALOG,
  fetchFontCatalog,
  FontRequestError,
  uploadFontFile,
} from '../../src/client/font-catalog.ts'

/** Catalogue body the Host would answer with. */
const BODY = {
  fontDir: '/home/example/.dsh/fonts',
  system: ['Georgia'],
  systemUnavailable: null,
  uploaded: [{ id: 'alpha-1a2b3c4d.ttf', family: 'Alpha' }],
}

/** Every request the module made, in call order. */
interface Call {
  url: string
  init: RequestInit
}

/**
 * Stub `fetch` and record what the module asked for.
 * @param answer - response to give, or a thrower for a transport failure.
 * @returns the recorded calls.
 */
function stubFetch(answer: () => Response | Promise<Response>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(answer())
  })
  return calls
}

/**
 * Build a response double.
 * @param body - JSON body, or a reader that throws to model an unreadable one.
 * @param status - HTTP status.
 * @param statusText - HTTP status line reason.
 * @returns the response double.
 */
function response(body: unknown, status = 200, statusText = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => body instanceof Error ? Promise.reject(body) : Promise.resolve(body),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the empty catalogue', () => {
  it('claims no directory, no installed fonts, and no refusal yet', () => {
    // A read that has not happened must not be reported as a Host refusal.
    expect(EMPTY_FONT_CATALOG).toEqual({
      directory: '',
      system: null,
      systemUnavailable: null,
      uploaded: [],
    })
  })
})

describe('reading the catalogue', () => {
  it('asks this plugin own route and maps the body onto the row state', async () => {
    const calls = stubFetch(() => response(BODY))
    const catalog = await fetchFontCatalog(new AbortController().signal)
    expect(calls[0]?.url).toBe(FONT_CATALOG_ROUTE)
    expect(catalog).toEqual({
      directory: '/home/example/.dsh/fonts',
      system: ['Georgia'],
      systemUnavailable: null,
      uploaded: [{ id: 'alpha-1a2b3c4d.ttf', family: 'Alpha' }],
    })
  })

  it('carries the reason the installed fonts are missing', async () => {
    stubFetch(() => response({ ...BODY, system: null, systemUnavailable: 'remote' }))
    const catalog = await fetchFontCatalog(new AbortController().signal)
    expect(catalog.system).toBeNull()
    expect(catalog.systemUnavailable).toBe('remote')
  })

  it('passes the caller signal through, so unloading aborts the read', async () => {
    const calls = stubFetch(() => response(BODY))
    const controller = new AbortController()
    await fetchFontCatalog(controller.signal)
    expect(calls[0]?.init.signal).toBe(controller.signal)
  })

  it('reports the reason the Host gave with its status', async () => {
    stubFetch(() => response({ error: 'scan is disabled' }, 403, 'Forbidden'))
    const failure = await fetchFontCatalog(new AbortController().signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FontRequestError)
    expect((failure as FontRequestError).message).toBe('scan is disabled')
    expect((failure as FontRequestError).status).toBe(403)
    expect((failure as FontRequestError).name).toBe('FontRequestError')
  })

  it('names a refusal whose body could not be read by its status line', async () => {
    // A proxy or a crash can answer with a status and no JSON at all; the row
    // still has to say something true about what happened.
    stubFetch(() => response(new SyntaxError('unexpected token'), 502, 'Bad Gateway'))
    const failure = await fetchFontCatalog(new AbortController().signal).catch((error: unknown) => error)
    expect((failure as FontRequestError).message).toBe('502 Bad Gateway')
    expect((failure as FontRequestError).status).toBe(502)
  })

  it('reports a request that never completed as a transport failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')))
    const failure = await fetchFontCatalog(new AbortController().signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FontRequestError)
    expect((failure as FontRequestError).message).toBe('network down')
    // No Host ever answered, so there is no status to report.
    expect((failure as FontRequestError).status).toBe(0)
  })

  it('names a transport failure that was not an Error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject('offline'))
    const failure = await fetchFontCatalog(new AbortController().signal).catch((error: unknown) => error)
    expect((failure as FontRequestError).message).toBe('offline')
  })
})

describe('storing a font', () => {
  it('posts the bytes to the collection route and returns the stored entry', async () => {
    const calls = stubFetch(() => response({ id: 'alpha-1a2b3c4d.ttf', family: 'Alpha' }, 201))
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const summary = await uploadFontFile(bytes, new AbortController().signal)
    expect(summary).toEqual({ id: 'alpha-1a2b3c4d.ttf', family: 'Alpha' })
    expect(calls[0]?.url).toBe(FONT_COLLECTION_ROUTE)
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(bytes)
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.['content-type'])
      .toBe('application/octet-stream')
  })

  it('surfaces the Host reason for a file it would not store', async () => {
    stubFetch(() => response({ error: 'uploaded bytes are not a font' }, 400, 'Bad Request'))
    const failure = await uploadFontFile(new ArrayBuffer(4), new AbortController().signal)
      .catch((error: unknown) => error)
    expect((failure as FontRequestError).message).toBe('uploaded bytes are not a font')
    expect((failure as FontRequestError).status).toBe(400)
  })
})

describe('deleting a font', () => {
  it('sends the id to the collection route and resolves on success', async () => {
    const calls = stubFetch(() => ({ ok: true, status: 204, statusText: '', json: () => Promise.resolve({}) }) as unknown as Response)
    await expect(deleteFontFile('alpha-1a2b3c4d.ttf', new AbortController().signal)).resolves.toBeUndefined()
    expect(calls[0]?.url).toBe(`${FONT_COLLECTION_ROUTE}/alpha-1a2b3c4d.ttf`)
    expect(calls[0]?.init.method).toBe('DELETE')
  })

  it('escapes an id so it cannot name another route', async () => {
    const calls = stubFetch(() => ({ ok: true, status: 204, statusText: '', json: () => Promise.resolve({}) }) as unknown as Response)
    await deleteFontFile('../secrets', new AbortController().signal)
    expect(calls[0]?.url).toBe(`${FONT_COLLECTION_ROUTE}/..%2Fsecrets`)
  })

  it('reports a font the Host does not have', async () => {
    stubFetch(() => response({ error: 'no such font' }, 404, 'Not Found'))
    const failure = await deleteFontFile('gone.ttf', new AbortController().signal).catch((error: unknown) => error)
    expect((failure as FontRequestError).message).toBe('no such font')
    expect((failure as FontRequestError).status).toBe(404)
  })
})
