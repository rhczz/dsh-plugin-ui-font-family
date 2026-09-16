/**
 * Browser-side access to the Host font routes. Every call targets this
 * plugin's own prefix; no other plugin's transport is involved.
 * @module dsh-plugin-ui-font-family/client/font-catalog
 */

import {
  FONT_CATALOG_ROUTE,
  FONT_COLLECTION_ROUTE,
  type FontCatalogResponse,
  type FontErrorResponse,
  type FontSystemUnavailableReason,
  type FontUploadSummary,
} from '../font-api.ts'

/** Catalogue as the settings row needs it. */
export interface FontCatalog {
  /**
   * Absolute directory holding uploaded fonts, so the page can name the place
   * a hand-copied file belongs. Empty before the first successful read.
   */
  directory: string
  /** Installed families, or null when the Host did not enumerate them. */
  system: readonly string[] | null
  /**
   * Why {@link FontCatalog.system} is null, or null while no read has
   * succeeded yet — an unread catalogue must not be reported as a refusal.
   */
  systemUnavailable: FontSystemUnavailableReason | null
  /** Uploaded fonts. */
  uploaded: readonly FontUploadSummary[]
}

/** Catalogue state before anything has been read. */
export const EMPTY_FONT_CATALOG: FontCatalog = Object.freeze({
  directory: '',
  system: null,
  systemUnavailable: null,
  uploaded: [],
})

/** A font request the Host refused, or one that never reached it. */
export class FontRequestError extends Error {
  /** HTTP status, or 0 when the request never completed. */
  readonly status: number

  /**
   * @param message - reason to show the operator.
   * @param status - HTTP status, or 0 for a transport failure.
   */
  constructor(message: string, status: number) {
    super(message)
    this.name = 'FontRequestError'
    this.status = status
  }
}

/**
 * Send one request, turning a transport failure into {@link FontRequestError}.
 * @param url - route to call.
 * @param init - fetch options.
 * @returns the raw response, refusals included.
 * @throws {FontRequestError} when the request never completed.
 */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    throw new FontRequestError(error instanceof Error ? error.message : String(error), 0)
  }
}

/**
 * Read the Host's reason from a refusal.
 * @param response - refused response.
 * @returns the reason, or the status line when the body carried none.
 */
async function refusalReason(response: Response): Promise<string> {
  try {
    return ((await response.json()) as FontErrorResponse).error
  } catch {
    // A refusal without a readable body still has to name itself, and the
    // status line is the only fact left to name it with.
    return `${response.status} ${response.statusText}`
  }
}

/**
 * Read one successful response body.
 * @param response - response to read.
 * @returns the parsed body.
 * @throws {FontRequestError} when the Host refused the request.
 */
async function readBody<T>(response: Response): Promise<T> {
  if (!response.ok) throw new FontRequestError(await refusalReason(response), response.status)
  return await response.json() as T
}

/**
 * Read the catalogue.
 * @param signal - aborts the request, e.g. when the plugin unloads.
 * @returns the catalogue the row renders.
 * @throws {FontRequestError} when the Host refused or the request failed.
 */
export async function fetchFontCatalog(signal: AbortSignal): Promise<FontCatalog> {
  const body = await readBody<FontCatalogResponse>(await send(FONT_CATALOG_ROUTE, { signal }))
  return {
    directory: body.fontDir,
    system: body.system,
    systemUnavailable: body.systemUnavailable,
    uploaded: body.uploaded,
  }
}

/**
 * Store one font file.
 * @param bytes - file contents.
 * @param signal - aborts the request.
 * @returns the stored entry, whose id the selection persists.
 * @throws {FontRequestError} when the bytes are not a font or the request failed.
 */
export async function uploadFontFile(bytes: ArrayBuffer, signal: AbortSignal): Promise<FontUploadSummary> {
  const response = await send(FONT_COLLECTION_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
    signal,
  })
  return readBody<FontUploadSummary>(response)
}

/**
 * Delete one stored font.
 * @param id - stored font id.
 * @param signal - aborts the request.
 * @throws {FontRequestError} when the Host refused or the request failed.
 */
export async function deleteFontFile(id: string, signal: AbortSignal): Promise<void> {
  const response = await send(`${FONT_COLLECTION_ROUTE}/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
  if (!response.ok) throw new FontRequestError(await refusalReason(response), response.status)
}
