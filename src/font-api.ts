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
 * Body of {@link FONT_CATALOG_ROUTE}.
 *
 * `system` is null rather than empty when the Host declined to enumerate
 * installed fonts: a browser reaching the Host from another machine would
 * otherwise present the server's fonts as if they were installed locally.
 */
export interface FontCatalogResponse {
  /**
   * Absolute user font directory, so the settings page can tell the user where
   * a hand-copied file belongs rather than describing it in prose.
   */
  fontDir: string
  /** Installed font families, or null when the Host did not enumerate them. */
  system: readonly string[] | null
  /** Why {@link FontCatalogResponse.system} is null; null when it is not. */
  systemUnavailable: FontSystemUnavailableReason | null
  /** Fonts in the Host's user font directory. */
  uploaded: readonly FontUploadSummary[]
}

/** Body of every rejected request. */
export interface FontErrorResponse {
  /** Reason the Host refused, phrased for the operator. */
  error: string
}
