/**
 * The user font directory under the harness home: the `upload` catalogue.
 * Fonts uploaded from the settings page and fonts copied in by hand are the
 * same kind of entry and reach the browser the same way.
 *
 * A write stages its bytes as `<stored id>.staging` and renames them into
 * place, so a crash mid-write leaves at most one staged file. That name has an
 * extension this plugin does not accept and an id no catalogue names, so every
 * read here ignores it.
 *
 * Reading a family name reads and parses the whole file, so the directory
 * remembers what each file declared and re-reads only what moved.
 * @module dsh-plugin-ui-font-family/user-fonts
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { FontUploadSummary } from './font-api.ts'
import {
  detectFontFileExtension,
  isFontFileName,
  isMissingEntry,
  readFontFamilies,
  type FontFileLogger,
} from './font-files.ts'
import type { FontFileExtension } from './font-formats.ts'

/** Directory name appended to the harness home when no path is configured. */
export const USER_FONT_DIR_NAME = 'fonts'

/** Longest family-derived part of a stored file name. */
const MAX_SLUG_LENGTH = 48

/**
 * Hex digits of randomness in a stored id.
 *
 * The slug is derived from the family name, so two files declaring the same
 * family produce the same prefix; the random part is what keeps the second one
 * from overwriting the first. Sixty-four bits is far past the point where a
 * directory of hand-uploaded fonts could collide by accident.
 */
const STORED_ID_RANDOM_LENGTH = 16

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
 * One stored file's family name, with the identity it was read from. A file
 * replaced under the same id has a different size or modification time and is
 * read again.
 */
interface CachedFamily {
  /** Family name the file declared when it was read. */
  family: string
  /** File size in bytes at that read. */
  size: number
  /** Modification time in milliseconds at that read. */
  mtimeMs: number
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
  /** Family names already read, by stored id. */
  private readonly cachedFamilies = new Map<string, CachedFamily>()

  /**
   * @param directory - absolute directory holding the user's fonts.
   * @param logger - sink for the aggregate skip warning.
   */
  constructor(directory: string, logger: FontFileLogger) {
    this.directory = directory
    this.logger = logger
  }

  /**
   * Read the directory this instance owns.
   * @returns the absolute directory path.
   */
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
   * uploaded through this plugin. Only a file whose identity moved is parsed
   * again, so a repeated read costs one listing and one `stat` per entry.
   * @returns summaries sorted by family name; unreadable candidates are skipped
   * and reported through one aggregate warning.
   */
  async list(): Promise<readonly FontUploadSummary[]> {
    const summaries: FontUploadSummary[] = []
    const ids = await this.ids()
    let unusable = 0
    let firstFailure: unknown
    for (const id of ids) {
      const family = await this.readFamily(id).catch((error: unknown) => {
        unusable += 1
        firstFailure ??= error
        return undefined
      })
      if (family !== undefined) summaries.push({ id, family })
    }
    this.forgetMissing(ids)
    if (unusable > 0) {
      this.logger.warn(
        `ui-font-family: skipped ${unusable} unreadable files in ${this.directory}; first failure: ${String(firstFailure)}`,
      )
    }
    return summaries.sort((left, right) => left.family.localeCompare(right.family))
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
    const id = `${fontFileSlug(family)}-${randomUUID().replaceAll('-', '').slice(0, STORED_ID_RANDOM_LENGTH)}${extension}`
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
    // The bytes were just parsed, so the next read answers from here.
    const written = await stat(target)
    this.cachedFamilies.set(id, { family, size: written.size, mtimeMs: written.mtimeMs })
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
   * @returns whether a file was removed; false when there was nothing to remove.
   * @throws when the file is there but could not be removed, which is not the
   * same answer as a font that is already gone.
   */
  async remove(id: string): Promise<boolean> {
    if (!isStoredFontId(id)) return false
    try {
      await rm(join(this.directory, id))
      this.cachedFamilies.delete(id)
      return true
    } catch (error) {
      // A font that is already gone is the outcome the caller asked for. A
      // directory in its place, or a file the Host may not unlink, is not.
      if (isMissingEntry(error)) return false
      throw error
    }
  }

  /**
   * Read one stored font's family name, reusing what an earlier read learned.
   *
   * A settings document can name a file the user deleted or replaced with
   * something unusable, so an unreadable id is an answer rather than a
   * failure. {@link list} counts and reports those reads.
   * @param id - stored font id.
   * @returns the declared family name, or undefined when the id or its file
   * cannot be read.
   */
  async familyOf(id: string): Promise<string | undefined> {
    if (!isStoredFontId(id)) return undefined
    try {
      return await this.readFamily(id)
    } catch {
      // A missing file and an unusable one mean the same thing here: no
      // family to report.
      return undefined
    }
  }

  /**
   * Read one stored font's family name, reusing the read of an unchanged file.
   * @param id - stored font id, already checked by {@link familyOf}.
   * @returns the declared family name.
   * @throws when the file cannot be read or holds no readable face.
   */
  private async readFamily(id: string): Promise<string> {
    const path = join(this.directory, id)
    // Read the identity before the bytes: a file replaced mid-read is then
    // cached under the older identity, so the next read sees the mismatch.
    const before = await stat(path)
    const cached = this.cachedFamilies.get(id)
    if (cached !== undefined && cached.size === before.size && cached.mtimeMs === before.mtimeMs) {
      return cached.family
    }
    const family = readFontFamilies(await readFile(path))[0]
    this.cachedFamilies.set(id, { family, size: before.size, mtimeMs: before.mtimeMs })
    return family
  }

  /**
   * Drop remembered names for files this listing did not carry.
   * @param ids - stored ids the listing found.
   */
  private forgetMissing(ids: readonly string[]): void {
    const present = new Set(ids)
    for (const id of this.cachedFamilies.keys()) {
      if (!present.has(id)) this.cachedFamilies.delete(id)
    }
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
