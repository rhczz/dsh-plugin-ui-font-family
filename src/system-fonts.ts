/**
 * The fonts installed on the machine running the Host. The catalogue is read
 * from the platform font directories; it describes the Host's machine, which
 * is why the browser only receives it for a request that arrived from that
 * same machine.
 * @module dsh-plugin-ui-font-family/system-fonts
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isFontFileName, isMissingEntry, readFontFamilies, type FontFileLogger } from './font-files.ts'

/**
 * Font directories of each desktop platform, most specific last. `~` expands
 * to the home directory of the user running the Host.
 */
export const PLATFORM_FONT_DIRS: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  darwin: ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', '~/Library/Fonts'],
  win32: ['C:/Windows/Fonts', '~/AppData/Local/Microsoft/Windows/Fonts'],
  linux: ['/usr/share/fonts', '/usr/local/share/fonts', '~/.local/share/fonts', '~/.fonts'],
}

/**
 * Directory nesting scanned below each root. Symlinked directories are not
 * followed: `readdir` reports one as a symbolic link, which is neither a
 * directory nor a font file, so a root cannot link outside its tree.
 */
const MAX_SCAN_DEPTH = 4

/**
 * Font files read at once during a scan. Each file is read whole for one name
 * table, so the scan is bound by storage latency; the bound also caps the open
 * file handles one scan holds while the session's own I/O shares the device.
 */
const SCAN_CONCURRENCY = 8

/**
 * Expand the platform font directories for the current platform.
 * @param platform - platform to read, defaulting to the running one.
 * @param home - home directory backing `~`.
 * @returns absolute directory paths; empty on a platform with no known layout.
 */
export function platformFontDirs(platform: NodeJS.Platform = process.platform, home: string = homedir()): readonly string[] {
  return (PLATFORM_FONT_DIRS[platform] ?? []).map(dir => dir.startsWith('~/') ? join(home, dir.slice(2)) : dir)
}

/** Files and directories one walk could not use. */
interface FontWalk {
  /** Paths carrying an accepted font extension. */
  files: string[]
  /** Directories that could not be read. */
  unreadable: number
}

/**
 * What one font file declared, with the identity it was read from. A file whose
 * size and modification time still match cannot have changed its name table.
 */
interface ScannedFile {
  /** Family names the file's faces declared. */
  families: readonly string[]
  /** File size in bytes at that read. */
  size: number
  /** Modification time in milliseconds at that read. */
  mtimeMs: number
}

/**
 * Collect the font files below one directory.
 * @param dir - directory to walk.
 * @param depth - levels still allowed below `dir`.
 * @returns the candidate file paths and the count of unreadable directories.
 */
async function collectFontFiles(dir: string, depth: number): Promise<FontWalk> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    // A platform directory this machine does not have is an absence, not a
    // fault: a Linux host has no /System/Library/Fonts and no ~/Library/Fonts.
    // Only a read that failed for another reason — a permission, a file where a
    // directory belongs — is counted for the caller's aggregate warning.
    return isMissingEntry(error) ? { files: [], unreadable: 0 } : { files: [], unreadable: 1 }
  }
  const files: string[] = []
  let unreadable = 0
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth <= 0) continue
      const nested = await collectFontFiles(path, depth - 1)
      files.push(...nested.files)
      unreadable += nested.unreadable
      continue
    }
    if (entry.isFile() && isFontFileName(entry.name)) files.push(path)
  }
  return { files, unreadable }
}

/**
 * Process-lifetime cache of the installed font families, scanned on first use
 * and re-scanned only when {@link SystemFontIndex.refresh} asks. No request can
 * observe a font directory change, so nothing warms this index ahead of one.
 */
export class SystemFontIndex {
  private readonly roots: readonly string[]
  private readonly logger: FontFileLogger
  /** Family names already read, by absolute file path. */
  private readonly scannedFiles = new Map<string, ScannedFile>()
  private cached: readonly string[] | undefined
  private pending: Promise<readonly string[]> | undefined

  /**
   * @param roots - absolute directories to scan, in order.
   * @param logger - sink for the aggregate skip warning.
   */
  constructor(roots: readonly string[], logger: FontFileLogger) {
    this.roots = roots
    this.logger = logger
  }

  /**
   * Read the installed font families, scanning on the first call.
   * A failed scan is not cached, so the next call retries instead of pinning
   * the failure for the process lifetime.
   * @returns family names, sorted and deduplicated.
   */
  async families(): Promise<readonly string[]> {
    if (this.cached !== undefined) return this.cached
    this.pending ??= this.scan().then(
      (families) => {
        this.cached = families
        return families
      },
      /* v8 ignore start -- scan() contains every directory and file failure itself and has no other throwing step, so this arm cannot run today; it stays because the doc above promises a failed scan is never cached, and without it a future throwing step would pin the failure for the process lifetime. */
      (error: unknown) => {
        this.pending = undefined
        throw error
      },
      /* v8 ignore stop */
    )
    return this.pending
  }

  /**
   * Discard the family list and scan again, for the user who installed a font
   * on this machine.
   *
   * Files the previous scan read are recognised by their identity and skipped,
   * so a rescan reads what changed rather than the whole library.
   * @returns family names from the new scan.
   */
  async refresh(): Promise<readonly string[]> {
    this.cached = undefined
    this.pending = undefined
    return this.families()
  }

  /** Walk every root and parse what it holds, a few files at a time. */
  private async scan(): Promise<readonly string[]> {
    const families = new Set<string>()
    let unreadableDirs = 0
    const candidates: string[] = []
    for (const root of this.roots) {
      const walk = await collectFontFiles(root, MAX_SCAN_DEPTH)
      unreadableDirs += walk.unreadable
      candidates.push(...walk.files)
    }

    let unusableFiles = 0
    let firstFailure: unknown
    const queue = candidates
    let cursor = 0
    const worker = async (): Promise<void> => {
      // The cursor advances before the first await, so no two workers take the
      // same path.
      for (let path = queue[cursor]; path !== undefined; path = queue[cursor]) {
        cursor += 1
        // Read the identity before the bytes: a file replaced mid-read is then
        // remembered under the older identity, so the next scan re-reads it.
        try {
          const before = await stat(path)
          const scanned = this.scannedFiles.get(path)
          if (scanned !== undefined && scanned.size === before.size && scanned.mtimeMs === before.mtimeMs) {
            for (const family of scanned.families) families.add(family)
            continue
          }
          const read = readFontFamilies(await readFile(path))
          this.scannedFiles.set(path, { families: read, size: before.size, mtimeMs: before.mtimeMs })
          for (const family of read) families.add(family)
        } catch (error) {
          unusableFiles += 1
          firstFailure ??= error
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, queue.length) }, () => worker()))
    this.forgetMissing(queue)

    if (unreadableDirs > 0 || unusableFiles > 0) {
      this.logger.warn(
        `ui-font-family: skipped ${unreadableDirs} unreadable font directories and ${unusableFiles} unreadable font files; first failure: ${String(firstFailure)}`,
      )
    }
    return [...families].sort((left, right) => left.localeCompare(right))
  }

  /**
   * Drop remembered names for files this scan did not find.
   * @param paths - candidate paths the walk found.
   */
  private forgetMissing(paths: readonly string[]): void {
    const present = new Set(paths)
    for (const path of this.scannedFiles.keys()) {
      if (!present.has(path)) this.scannedFiles.delete(path)
    }
  }
}
