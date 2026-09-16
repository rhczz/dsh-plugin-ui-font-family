import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { platformFontDirs, PLATFORM_FONT_DIRS, SystemFontIndex } from '../src/system-fonts.ts'

/** OFL-licensed fixture whose name table declares the family "Silkscreen". */
const FIXTURE = fileURLToPath(new URL('./fixtures/Silkscreen-Regular.ttf', import.meta.url))

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Create a temporary directory to scan as a font root.
 * @returns its absolute path.
 */
async function createRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-system-fonts-'))
  roots.push(dir)
  return dir
}

/**
 * Copy the font fixture to `path`.
 * @param path - destination file path.
 */
async function installFixture(path: string): Promise<void> {
  await writeFile(path, await readFile(FIXTURE))
}

/**
 * Family the renamed fixture declares. Same length as the original, because
 * the replacement is written over the name table in place.
 */
const SECOND_FAMILY = 'Zzzzzzzzzz'

/**
 * Copy the fixture with its declared family replaced, so one root can hold two
 * families and the catalogue order becomes observable.
 * @param path - destination file path.
 */
async function installSecondFamily(path: string): Promise<void> {
  const bytes = Buffer.from(await readFile(FIXTURE))
  for (const encoding of ['latin1', 'utf16le'] as const) {
    const needle = Buffer.from('Silkscreen', encoding)
    for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + needle.length)) {
      bytes.write(SECOND_FAMILY, at, encoding)
    }
  }
  await writeFile(path, bytes)
}

describe('platformFontDirs', () => {
  it('expands every home placeholder for each platform it knows', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const dirs = platformFontDirs(platform, '/home/example')
      expect(dirs.some(dir => dir.startsWith('/home/example/'))).toBe(true)
      expect(dirs.every(dir => !dir.includes('~'))).toBe(true)
    }
  })

  it('keeps the platform directories in place for a platform it knows', () => {
    const dirs = platformFontDirs('darwin', '/home/example')
    expect(dirs).toEqual(PLATFORM_FONT_DIRS.darwin?.map(dir => dir.replace('~', '/home/example')))
    expect(dirs).toContain('/System/Library/Fonts')
  })

  it('reports nothing on a platform with no known layout', () => {
    expect(platformFontDirs('aix' as NodeJS.Platform, '/home/example')).toEqual([])
  })
})

describe('SystemFontIndex', () => {
  it('reads the families of every font below its roots', async () => {
    const root = await createRoot()
    await installFixture(join(root, 'Silkscreen-Regular.ttf'))
    const index = new SystemFontIndex([root], { warn: vi.fn() })
    await expect(index.families()).resolves.toEqual(['Silkscreen'])
  })

  it('scans nested directories within the depth bound', async () => {
    const root = await createRoot()
    const nested = join(root, 'a', 'b')
    await mkdir(nested, { recursive: true })
    await installFixture(join(nested, 'Silkscreen-Regular.ttf'))
    const index = new SystemFontIndex([root], { warn: vi.fn() })
    await expect(index.families()).resolves.toEqual(['Silkscreen'])
  })

  it('stops at the depth bound instead of walking a whole tree', async () => {
    // A font directory is shallow by construction; the bound is what keeps a
    // symlinked or pathological tree from turning one scan into a full walk.
    const root = await createRoot()
    const tooDeep = join(root, 'a', 'b', 'c', 'd', 'e')
    await mkdir(tooDeep, { recursive: true })
    await installFixture(join(tooDeep, 'Silkscreen-Regular.ttf'))
    const index = new SystemFontIndex([root], { warn: vi.fn() })
    // Below the bound the file is found and has to be skipped, not reported as
    // unreadable: nothing failed, the walk simply stops.
    await expect(index.families()).resolves.toEqual([])
  })

  it('deduplicates a family installed more than once', async () => {
    const root = await createRoot()
    await installFixture(join(root, 'a.ttf'))
    await installFixture(join(root, 'b.ttf'))
    const index = new SystemFontIndex([root], { warn: vi.fn() })
    await expect(index.families()).resolves.toEqual(['Silkscreen'])
  })

  it('reports families in name order regardless of the order they were read', async () => {
    const root = await createRoot()
    // The later name is read first, so a catalogue that merely preserved read
    // order would come back reversed.
    await installSecondFamily(join(root, 'a.ttf'))
    await installFixture(join(root, 'b.ttf'))
    const index = new SystemFontIndex([root], { warn: vi.fn() })
    await expect(index.families()).resolves.toEqual(['Silkscreen', SECOND_FAMILY])
  })

  it('treats an absent root as ordinary and reports it once', async () => {
    const logger = { warn: vi.fn() }
    const index = new SystemFontIndex([join(tmpdir(), 'dsh-fonts-that-do-not-exist')], logger)
    await expect(index.families()).resolves.toEqual([])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/1 unreadable font directories/)
  })

  it('skips a file with a font extension that is not a font', async () => {
    const logger = { warn: vi.fn() }
    const root = await createRoot()
    await writeFile(join(root, 'broken.ttf'), 'prose wearing a font extension')
    await installFixture(join(root, 'good.ttf'))
    const index = new SystemFontIndex([root], logger)
    await expect(index.families()).resolves.toEqual(['Silkscreen'])
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/1 unreadable font files/)
  })

  it('ignores a file whose name is not an accepted format', async () => {
    const logger = { warn: vi.fn() }
    const root = await createRoot()
    await writeFile(join(root, 'licence.txt'), 'not a candidate')
    const index = new SystemFontIndex([root], logger)
    await expect(index.families()).resolves.toEqual([])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('scans once and serves the cache afterwards', async () => {
    const root = await createRoot()
    await installFixture(join(root, 'Silkscreen-Regular.ttf'))
    const index = new SystemFontIndex([root], { warn: vi.fn() })
    const first = await index.families()
    await rm(join(root, 'Silkscreen-Regular.ttf'))
    await expect(index.families()).resolves.toBe(first)
  })

  it('scans again after a refresh', async () => {
    const root = await createRoot()
    const index = new SystemFontIndex([root], { warn: vi.fn() })
    await expect(index.families()).resolves.toEqual([])
    await installFixture(join(root, 'Silkscreen-Regular.ttf'))
    await expect(index.refresh()).resolves.toEqual(['Silkscreen'])
  })

  it('reads every root in order', async () => {
    const first = await createRoot()
    const second = await createRoot()
    await installFixture(join(second, 'face.ttf'))
    const index = new SystemFontIndex([first, second], { warn: vi.fn() })
    await expect(index.families()).resolves.toEqual(['Silkscreen'])
  })
})
