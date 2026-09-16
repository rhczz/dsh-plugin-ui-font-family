/**
 * The plugin's HTTP routes. The browser reads the catalogue, uploads a font,
 * fetches a stored font's bytes, and deletes one through these paths.
 * @module dsh-plugin-ui-font-family/font-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import {
  FONT_CATALOG_ROUTE,
  FONT_COLLECTION_ROUTE,
  type FontCatalogResponse,
  type FontErrorResponse,
} from './font-api.ts'
import { detectFontFileExtension, type FontFileExtension } from './font-files.ts'
import type { SystemFontIndex } from './system-fonts.ts'
import type { UserFontDirectory } from './user-fonts.ts'

/** Media type served per stored extension; the record forces one entry per accepted format. */
const FONT_CONTENT_TYPES: Readonly<Record<FontFileExtension, string>> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttc': 'font/collection',
}

/** Everything the route handlers read. */
export interface FontRouteDeps {
  /** User font directory backing the `upload` catalogue. */
  userFonts: UserFontDirectory
  /** Installed-font index; undefined when the composition turned scanning off. */
  systemFonts: SystemFontIndex | undefined
  /** Largest accepted upload body in bytes. */
  maxUploadBytes: number
  /** Called after a write changed the user font catalogue. */
  onCatalogChanged: () => void
}

/**
 * Strip the IPv4-mapped prefix and any IPv6 zone a peer address carries, so
 * two spellings of one address compare equal.
 * @param address - address as Node reports it.
 * @returns the bare address.
 */
function normalizeAddress(address: string): string {
  const mapped = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  const zone = mapped.indexOf('%')
  return zone === -1 ? mapped : mapped.slice(0, zone)
}

/**
 * Collect every address this host answers on, loopback included.
 * @returns the address set a same-machine request arrives from.
 */
export function localHostAddresses(): ReadonlySet<string> {
  const addresses = new Set<string>(['127.0.0.1', '::1'])
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) addresses.add(normalizeAddress(entry.address))
  }
  return addresses
}

/**
 * Test whether a request arrived from the machine running the Host.
 *
 * This is a security invariant, not a preference: the installed-font
 * catalogue describes the Host, and a browser on another machine must not
 * receive it. It is therefore a fixed rule rather than a config field.
 * @param remoteAddress - peer address Node reported for the request.
 * @param local - addresses from {@link localHostAddresses}.
 * @returns whether the peer is this host.
 */
export function isLocalPeer(remoteAddress: string | undefined, local: ReadonlySet<string>): boolean {
  return remoteAddress !== undefined && local.has(normalizeAddress(remoteAddress))
}

/**
 * Write one JSON response.
 * @param res - response to own.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Refuse one request with a reason the operator can read.
 * @param res - response to own.
 * @param status - HTTP status code.
 * @param error - reason, phrased for the operator.
 */
function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error } satisfies FontErrorResponse)
}

/**
 * Read a request body, refusing one past the accepted size.
 * @param req - request to drain.
 * @param limit - largest accepted body in bytes.
 * @returns the bytes, or undefined once the body exceeds `limit`.
 */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) return undefined
  const chunks: Buffer[] = []
  let total = 0
  let overflowed = false
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    total += buffer.length
    if (total > limit) {
      // Keep draining instead of breaking out: an abandoned request stream
      // tears down the socket before the 413 can reach the client. Memory
      // stays bounded because the excess is discarded, not stored.
      overflowed = true
      continue
    }
    chunks.push(buffer)
  }
  return overflowed ? undefined : Buffer.concat(chunks)
}

/**
 * Decode one path segment into a stored font id.
 * @param segment - percent-encoded path segment.
 * @returns the decoded id; empty when the encoding is malformed, which the
 * stored-id validation then rejects.
 */
function decodeFontId(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    // A malformed escape cannot name a stored font, and `''` is not a stored
    // id, so the caller answers 404 without a second failure path.
    return ''
  }
}

/**
 * Store one uploaded font.
 * @param req - request carrying the font bytes.
 * @param res - response to own.
 * @param deps - directories and limits.
 */
async function handleUpload(req: IncomingMessage, res: ServerResponse, deps: FontRouteDeps): Promise<void> {
  const bytes = await readBody(req, deps.maxUploadBytes)
  if (bytes === undefined) {
    sendError(res, 413, `upload exceeds the ${deps.maxUploadBytes} byte limit`)
    return
  }
  try {
    const summary = await deps.userFonts.save(bytes)
    // Publish only at the commit point: a rejected upload changed nothing.
    deps.onCatalogChanged()
    sendJson(res, 201, summary)
  } catch (error) {
    if (error instanceof TypeError) {
      sendError(res, 400, error.message)
      return
    }
    sendError(res, 500, `could not store the uploaded font: ${String(error)}`)
  }
}

/**
 * Serve one stored font's bytes.
 * @param res - response to own.
 * @param deps - directories and limits.
 * @param id - stored font id.
 */
async function handleDownload(res: ServerResponse, deps: FontRouteDeps, id: string): Promise<void> {
  const bytes = await deps.userFonts.read(id)
  if (bytes === undefined) {
    sendError(res, 404, `no stored font named "${id}"`)
    return
  }
  // The media type restates what these bytes are rather than what the name
  // claims, so a hand-copied file whose name lies cannot mislabel a response.
  const extension = detectFontFileExtension(bytes)
  res.writeHead(200, {
    'content-type': extension === undefined ? 'application/octet-stream' : FONT_CONTENT_TYPES[extension],
    'content-length': String(bytes.length),
    // A stored id names one immutable file, so the bytes never go stale.
    'cache-control': 'private, max-age=31536000, immutable',
  })
  res.end(bytes)
}

/**
 * Delete one stored font.
 * @param res - response to own.
 * @param deps - directories and limits.
 * @param id - stored font id.
 */
async function handleDelete(res: ServerResponse, deps: FontRouteDeps, id: string): Promise<void> {
  if (!await deps.userFonts.remove(id)) {
    sendError(res, 404, `no stored font named "${id}"`)
    return
  }
  deps.onCatalogChanged()
  res.writeHead(204)
  res.end()
}

/**
 * Register the plugin's routes on the Host web server.
 *
 * Every route is a registration effect: disposing the owning context removes
 * the routes, so an unloaded plugin stops answering immediately.
 * @param ctx - context owning the web server.
 * @param deps - directories and limits the handlers read.
 */
export function registerFontRoutes(ctx: Context, deps: FontRouteDeps): void {
  const local = localHostAddresses()

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FONT_CATALOG_ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendError(res, 405, `method ${String(req.method)} is not allowed on ${FONT_CATALOG_ROUTE}`)
        return
      }
      const systemFonts = deps.systemFonts
      const system = systemFonts !== undefined && isLocalPeer(req.socket.remoteAddress, local)
        ? await systemFonts.families()
        : null
      sendJson(res, 200, {
        fontDir: deps.userFonts.path,
        system,
        systemUnavailable: system !== null ? null : systemFonts === undefined ? 'disabled' : 'remote',
        uploaded: await deps.userFonts.list(),
      } satisfies FontCatalogResponse)
    },
  }), `ui-font-family: GET ${FONT_CATALOG_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: FONT_COLLECTION_ROUTE,
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      if (pathname === FONT_COLLECTION_ROUTE) {
        if (req.method !== 'POST') {
          sendError(res, 405, `method ${String(req.method)} is not allowed on ${FONT_COLLECTION_ROUTE}`)
          return
        }
        await handleUpload(req, res, deps)
        return
      }
      const id = decodeFontId(pathname.slice(FONT_COLLECTION_ROUTE.length + 1))
      if (req.method === 'GET') {
        await handleDownload(res, deps, id)
        return
      }
      if (req.method === 'DELETE') {
        await handleDelete(res, deps, id)
        return
      }
      sendError(res, 405, `method ${String(req.method)} is not allowed on ${FONT_COLLECTION_ROUTE}/<id>`)
    },
  }), `ui-font-family: ${FONT_COLLECTION_ROUTE}/<id>`)
}
