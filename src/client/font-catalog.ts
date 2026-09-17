/**
 * Browser-side access to the Host font routes under this plugin's own prefix.
 * @module dsh-plugin-ui-font-family/client/font-catalog
 */

import {
  FONT_CATALOG_ROUTE,
  FONT_CATALOG_SYSTEM_FIELD,
  FONT_CATALOG_SYSTEM_REFRESH,
  FONT_COLLECTION_ROUTE,
  type FontCatalogResponse,
  type FontErrorResponse,
  type FontSystemUnavailableReason,
  type FontUploadSummary,
} from '../font-api.ts'

/** Catalogue as the settings row needs it. */
export interface FontCatalog {
  /**
   * Absolute directory holding uploaded fonts, so the page can name where a
   * hand-copied file belongs. Null before the first successful read, and null
   * when the Host declined to name it because this page runs elsewhere.
   */
  directory: string | null
  /** Installed families, or null when the Host did not enumerate them. */
  system: readonly string[] | null
  /**
   * Why {@link FontCatalog.system} is null, or null while no read has succeeded
   * yet: an unread catalogue is not a refusal.
   */
  systemUnavailable: FontSystemUnavailableReason | null
  /** Uploaded fonts. */
  uploaded: readonly FontUploadSummary[]
  /**
   * Largest upload the Host accepts, or undefined before the first successful
   * read. The page refuses a larger file with the Host's own number.
   */
  maxUploadBytes: number | undefined
}

/** Catalogue state before anything has been read. */
export const EMPTY_FONT_CATALOG: FontCatalog = Object.freeze({
  directory: null,
  system: null,
  systemUnavailable: null,
  uploaded: [],
  maxUploadBytes: undefined,
})

/** What one catalogue read asks the Host for beyond the stored fonts. */
export interface FontCatalogReadOptions {
  /**
   * Read the installed fonts again instead of answering from the Host's cache.
   * Only a user action asks for this: no request observes a font installation.
   */
  system?: boolean
}

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
 * @param options - what this read asks the Host for beyond the stored fonts.
 * @returns the catalogue the row renders.
 * @throws {FontRequestError} when the Host refused or the request failed.
 */
export async function fetchFontCatalog(signal: AbortSignal, options: FontCatalogReadOptions = {}): Promise<FontCatalog> {
  const query = options.system === true
    ? `?${FONT_CATALOG_SYSTEM_FIELD}=${FONT_CATALOG_SYSTEM_REFRESH}`
    : ''
  const body = await readBody<FontCatalogResponse>(await send(`${FONT_CATALOG_ROUTE}${query}`, { signal }))
  return {
    directory: body.fontDir,
    system: body.system,
    systemUnavailable: body.systemUnavailable,
    uploaded: body.uploaded,
    maxUploadBytes: body.maxUploadBytes,
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
