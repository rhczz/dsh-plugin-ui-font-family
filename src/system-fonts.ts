/**
 * The fonts installed on the machine running the Host. The catalogue is read
 * from the platform font directories; it describes the Host's machine, which
 * is why the browser only receives it for a request that arrived from that
 * same machine.
 * @module dsh-plugin-ui-font-family/system-fonts
 */

import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isFontFileName, readFontFamilies, type FontFileLogger } from './font-files.ts'

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
 * Directory nesting scanned below each root. Font directories keep their files
 * within a few levels; the bound stops a symlinked root from walking a whole
 * filesystem.
 */
const MAX_SCAN_DEPTH = 4

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
 * Collect the font files below one directory.
 * @param dir - directory to walk.
 * @param depth - levels still allowed below `dir`.
 * @returns the candidate file paths and the count of unreadable directories.
 */
async function collectFontFiles(dir: string, depth: number): Promise<FontWalk> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // An absent or unreadable platform directory is ordinary: a Linux host has
    // no /System/Library/Fonts. The count feeds the caller's aggregate warning.
    return { files: [], unreadable: 1 }
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
 * and re-scanned only when {@link SystemFontIndex.refresh} asks. A font
 * directory changes when an operator installs a font, which no request can
 * observe, so re-reading it per request would cost a full parse for nothing.
 */
export class SystemFontIndex {
  private readonly roots: readonly string[]
  private readonly logger: FontFileLogger
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
   * Discard the cache and scan again.
   * @returns family names from the new scan.
   */
  async refresh(): Promise<readonly string[]> {
    this.cached = undefined
    this.pending = undefined
    return this.families()
  }

  /** Walk every root and parse what it holds. */
  private async scan(): Promise<readonly string[]> {
    const families = new Set<string>()
    let unreadableDirs = 0
    let unusableFiles = 0
    let firstFailure: unknown
    for (const root of this.roots) {
      const walk = await collectFontFiles(root, MAX_SCAN_DEPTH)
      unreadableDirs += walk.unreadable
      for (const path of walk.files) {
        try {
          const bytes = await readFile(path)
          for (const family of readFontFamilies(bytes)) families.add(family)
        } catch (error) {
          unusableFiles += 1
          firstFailure ??= error
        }
      }
    }
    if (unreadableDirs > 0 || unusableFiles > 0) {
      this.logger.warn(
        `ui-font-family: skipped ${unreadableDirs} unreadable font directories and ${unusableFiles} unreadable font files; first failure: ${String(firstFailure)}`,
      )
    }
    return [...families].sort((left, right) => left.localeCompare(right))
  }
}
