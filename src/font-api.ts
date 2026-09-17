/**
 * HTTP surface of this plugin: the paths the Host serves and the browser
 * fetches, plus the bodies crossing between them. Both halves import this
 * module so a path or field can never drift to one side only.
 * @module dsh-plugin-ui-font-family/font-api
 */

/** Prefix every route of this plugin lives under. */
export const FONT_API_PREFIX = '/api/ui-font-family'

/** Route answering {@link FontCatalogResponse}. */
export const FONT_CATALOG_ROUTE = `${FONT_API_PREFIX}/catalog`

/**
 * Query field {@link FONT_CATALOG_ROUTE} reads to decide whether it answers from
 * the cached installed-font list or scans again. A browser sets it after the
 * user installs a font on the machine running the Host.
 */
export const FONT_CATALOG_SYSTEM_FIELD = 'system'

/** Value of {@link FONT_CATALOG_SYSTEM_FIELD} that asks for the scan again. */
export const FONT_CATALOG_SYSTEM_REFRESH = 'refresh'

/** Collection route: `POST` to upload, `GET`/`DELETE` with an appended font id. */
export const FONT_COLLECTION_ROUTE = `${FONT_API_PREFIX}/fonts`

/** One uploaded font as the catalogue and upload answers report it. */
export interface FontUploadSummary {
  /** File name inside the Host's user font directory; the persisted `upload` selection id. */
  id: string
  /** CSS family name the file's own name table declares. */
  family: string
}

/**
 * Why the Host did not enumerate the installed fonts. A code rather than a
 * sentence, so the page localizes the reason instead of showing Host prose.
 */
export type FontSystemUnavailableReason = 'remote' | 'disabled'

/**
 * Body of {@link FONT_CATALOG_ROUTE}. `system` is null rather than empty when
 * the Host declined to enumerate installed fonts: a browser reaching the Host
 * from another machine must not present those fonts as its own.
 */
export interface FontCatalogResponse {
  /**
   * Absolute user font directory, or null when the Host declined to name it. A
   * browser reaching the Host from another machine cannot copy a file into that
   * directory, so it is told nothing about the Host's filesystem.
   */
  fontDir: string | null
  /** Installed font families, or null when the Host did not enumerate them. */
  system: readonly string[] | null
  /** Why {@link FontCatalogResponse.system} is null; null when it is not. */
  systemUnavailable: FontSystemUnavailableReason | null
  /** Fonts in the Host's user font directory. */
  uploaded: readonly FontUploadSummary[]
  /**
   * Largest upload the Host accepts, in bytes, so the page can refuse an
   * oversized file before reading it. This is the Host's configured limit.
   */
  maxUploadBytes: number
}

/** Body of every rejected request. */
export interface FontErrorResponse {
  /** Reason the Host refused, phrased for the operator. */
  error: string
}
