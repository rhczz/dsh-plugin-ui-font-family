/**
 * The user font directory under the harness home. It is the `upload`
 * catalogue: fonts the user sent from the settings page and fonts the user
 * dropped into the directory by hand are the same kind of entry, and both
 * reach the browser the same way.
 * @module dsh-plugin-ui-font-family/user-fonts
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { FontUploadSummary } from './font-api.ts'
import {
  detectFontFileExtension,
  isFontFileName,
  readFontFamilies,
  type FontFileExtension,
  type FontFileLogger,
} from './font-files.ts'

/** Directory name appended to the harness home when no path is configured. */
export const USER_FONT_DIR_NAME = 'fonts'

/** Longest family-derived part of a stored file name. */
const MAX_SLUG_LENGTH = 48

/** Characters that may not appear in a stored font id. */
const PATH_SEPARATORS = /[/\\]/

/**
 * Turn a family name into the readable part of a stored file name.
 * @param family - CSS family name a font declares.
 * @returns a lower-case slug of ASCII letters, digits, and single hyphens.
 */
export function fontFileSlug(family: string): string {
  const slug = family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')
  return slug === '' ? 'font' : slug
}

/**
 * Test an id for naming a file this directory owns.
 *
 * Ids round-trip through an HTTP path and the settings document, so this is
 * the single gate that keeps a stored id from escaping the directory.
 * @param id - candidate file name.
 * @returns whether the id is a bare file name with an accepted extension.
 */
export function isStoredFontId(id: string): boolean {
  return id !== '' && id !== '.' && id !== '..' && !PATH_SEPARATORS.test(id) && isFontFileName(id)
}

/**
 * The user font directory and the operations the settings page performs on it.
 *
 * Reads never throw for an absent directory or an unusable file: both are
 * ordinary states that must leave the rest of the catalogue usable. Writes
 * reject with the reason, which the route turns into the response body.
 */
export class UserFontDirectory {
  private readonly directory: string
  private readonly logger: FontFileLogger

  /**
   * @param directory - absolute directory holding the user's fonts.
   * @param logger - sink for the aggregate skip warning.
   */
  constructor(directory: string, logger: FontFileLogger) {
    this.directory = directory
    this.logger = logger
  }

  /** @returns the absolute directory path. */
  get path(): string {
    return this.directory
  }

  /**
   * Create the directory when it does not exist yet.
   * @returns the absolute directory path.
   */
  async ensure(): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    return this.directory
  }

  /**
   * Read every usable font in the directory, including files that were never
   * uploaded through this plugin.
   * @returns summaries sorted by family name; unreadable candidates are
   * skipped and reported through one aggregate warning.
   */
  async list(): Promise<readonly FontUploadSummary[]> {
    const summaries: FontUploadSummary[] = []
    let unusable = 0
    let firstFailure: unknown
    for (const id of await this.ids()) {
      const family = await this.familyOf(id).catch((error: unknown) => {
        unusable += 1
        firstFailure ??= error
        return undefined
      })
      if (family !== undefined) summaries.push({ id, family })
    }
    if (unusable > 0) {
      this.logger.warn(
        `ui-font-family: skipped ${unusable} unreadable files in ${this.directory}; first failure: ${String(firstFailure)}`,
      )
    }
    return summaries.sort((left, right) => left.family.localeCompare(right.family))
  }

  /**
   * Read the catalogue in the form stack resolution consumes.
   * @returns family name by stored id.
   */
  async families(): Promise<ReadonlyMap<string, string>> {
    return new Map((await this.list()).map(entry => [entry.id, entry.family]))
  }

  /**
   * Store one uploaded file under a name this directory chooses.
   *
   * The container is identified from the bytes and the family name from the
   * font's own name table, so nothing the client sends decides what lands on
   * disk or what the entry is called.
   * @param bytes - complete upload body.
   * @returns the stored entry.
   * @throws {TypeError} when the bytes are not a font container this plugin
   * accepts, or when the container holds no readable face.
   */
  async save(bytes: Buffer): Promise<FontUploadSummary> {
    const extension: FontFileExtension | undefined = detectFontFileExtension(bytes)
    if (extension === undefined) {
      throw new TypeError('uploaded bytes are not a TrueType, OpenType, WOFF, WOFF2, or collection font')
    }
    const family = readFontFamilies(bytes)[0]
    const id = `${fontFileSlug(family)}-${randomUUID().slice(0, 8)}${extension}`
    await this.ensure()
    const target = join(this.directory, id)
    // Write beside the target and rename: a reader never observes a partial
    // file, and a crash mid-write leaves no half-registered entry.
    const staging = `${target}.staging`
    await writeFile(staging, bytes)
    try {
      await rename(staging, target)
    } catch (error) {
      await rm(staging, { force: true })
      throw error
    }
    return { id, family }
  }

  /**
   * Read one stored font's bytes.
   * @param id - stored font id.
   * @returns the bytes, or undefined when the id is unknown or unusable.
   */
  async read(id: string): Promise<Buffer | undefined> {
    if (!isStoredFontId(id)) return undefined
    try {
      return await readFile(join(this.directory, id))
    } catch {
      // A font deleted between the catalogue read and this request is absent,
      // not an error; the caller answers 404 the same way for both.
      return undefined
    }
  }

  /**
   * Delete one stored font.
   * @param id - stored font id.
   * @returns whether a file was removed.
   */
  async remove(id: string): Promise<boolean> {
    if (!isStoredFontId(id)) return false
    try {
      await rm(join(this.directory, id))
      return true
    } catch {
      // Already gone is the outcome the caller asked for.
      return false
    }
  }

  /**
   * Read one stored font's family name.
   * @param id - stored font id.
   * @returns the declared family name.
   * @throws {TypeError} when the id is unusable or the file is not a font.
   */
  private async familyOf(id: string): Promise<string> {
    /* v8 ignore next -- the only caller lists ids through this same guard, so it cannot run today; it stays beside the join because the guard is what keeps an id out of a path. */
    if (!isStoredFontId(id)) throw new TypeError(`not a stored font id: "${id}"`)
    return readFontFamilies(await readFile(join(this.directory, id)))[0]
  }

  /** List candidate file names, sorted for a stable catalogue order. */
  private async ids(): Promise<readonly string[]> {
    let entries
    try {
      entries = await readdir(this.directory, { withFileTypes: true })
    } catch {
      // A user who never uploaded anything has no directory yet; that is an
      // empty catalogue, not a failure.
      return []
    }
    return entries
      .filter(entry => entry.isFile() && isStoredFontId(basename(entry.name)))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  }
}
