import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFontFamilies } from '../src/font-files.ts'
import { fontFileSlug, isStoredFontId, UserFontDirectory } from '../src/user-fonts.ts'

// Counting the parse is how a case shows the directory reuses what it read.
// The wrapper calls the real implementation captured from the module itself, so
// every other case here still exercises the shipped parsing.
vi.mock('../src/font-files.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/font-files.ts')>()
  return { ...actual, readFontFamilies: vi.fn(actual.readFontFamilies) }
})

// Stored ids end in a random suffix. Pinning it lets a case put a file exactly
// where a rename is about to land, which is the only way to make that rename
// fail on purpose — the id pattern stays a valid one either way.
vi.mock('node:crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
}))

/** OFL-licensed fixture whose name table declares the family "Silkscreen". */
const FIXTURE = fileURLToPath(new URL('./fixtures/Silkscreen-Regular.ttf', import.meta.url))

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Create the user font directory under a fresh temporary parent.
 * @param logger - sink for skip warnings; a spy by default.
 * @returns the directory under test and its path.
 */
async function createDirectory(logger = { warn: vi.fn() }): Promise<{ fonts: UserFontDirectory; path: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-fonts-'))
  directories.push(parent)
  const path = join(parent, 'fonts')
  return { fonts: new UserFontDirectory(path, logger), path }
}

/**
 * Read the fixture's bytes.
 * @returns the TrueType file contents.
 */
async function fixtureBytes(): Promise<Buffer> {
  return readFile(FIXTURE)
}

/**
 * Copy the fixture with its declared family replaced, so one directory can hold
 * two families and a re-read of one id becomes observable.
 * @param family - replacement name, as long as the original the in-place patch
 * overwrites.
 * @returns the patched file contents.
 */
async function renamedFixture(family: string): Promise<Buffer> {
  const bytes = Buffer.from(await readFile(FIXTURE))
  for (const encoding of ['latin1', 'utf16le'] as const) {
    const needle = Buffer.from('Silkscreen', encoding)
    for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + needle.length)) {
      bytes.write(family, at, encoding)
    }
  }
  return bytes
}

describe('fontFileSlug', () => {
  it('lower-cases and hyphenates a family name', () => {
    expect(fontFileSlug('Noto Sans CJK SC')).toBe('noto-sans-cjk-sc')
  })

  it('collapses punctuation runs and trims the edges', () => {
    expect(fontFileSlug('  Silkscreen!!  Regular ')).toBe('silkscreen-regular')
  })

  it('falls back to a usable name when nothing survives', () => {
    expect(fontFileSlug('中文')).toBe('font')
    expect(fontFileSlug('')).toBe('font')
  })

  it('never ends in a hyphen, so the id keeps the extension separate', () => {
    const slug = fontFileSlug(`${'a'.repeat(60)} tail`)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('isStoredFontId', () => {
  it('accepts a bare file name with an accepted extension', () => {
    expect(isStoredFontId('silkscreen-1a2b3c4d.ttf')).toBe(true)
    expect(isStoredFontId('Face.woff2')).toBe(true)
  })

  it('rejects anything that could name a file outside the directory', () => {
    for (const id of ['../secret.ttf', 'a/b.ttf', 'a\\b.ttf', '/etc/passwd.ttf', '..', '.', '']) {
      expect(isStoredFontId(id), id).toBe(false)
    }
  })

  it('reads a percent escape as a literal file-name character', () => {
    // The collection route decodes its path segment before this check runs, so
    // an encoded separator never reaches here as one. What does reach here
    // names one file inside the directory, however odd that name looks.
    expect(isStoredFontId('..%2Fsecret.ttf')).toBe(true)
  })

  it('rejects a name that is not a font format', () => {
    expect(isStoredFontId('notes.txt')).toBe(false)
    expect(isStoredFontId('face')).toBe(false)
  })
})

describe('UserFontDirectory', () => {
  it('reads an absent directory as an empty catalogue rather than failing', async () => {
    const { fonts } = await createDirectory()
    await expect(fonts.list()).resolves.toEqual([])
  })

  it('reports the family of a stored id, and none for an id it cannot read', async () => {
    const { fonts, path } = await createDirectory()
    const stored = await fonts.save(await fixtureBytes())
    await expect(fonts.familyOf(stored.id)).resolves.toBe('Silkscreen')
    // An id no file carries, an id that could never be one, and a file that is
    // not a font are all "no family" rather than failures: a settings document
    // can outlive the file it names.
    await expect(fonts.familyOf('absent.ttf')).resolves.toBeUndefined()
    await expect(fonts.familyOf('../escape.ttf')).resolves.toBeUndefined()
    await writeFile(join(path, 'broken.ttf'), 'prose wearing a font extension')
    await expect(fonts.familyOf('broken.ttf')).resolves.toBeUndefined()
  })

  it('stores a genuine font and reports the family it declares', async () => {
    const { fonts, path } = await createDirectory()
    const stored = await fonts.save(await fixtureBytes())
    expect(stored.family).toBe('Silkscreen')
    expect(stored.id).toMatch(/^silkscreen-[0-9a-f]{16}\.ttf$/)
    await expect(readdir(path)).resolves.toEqual([stored.id])
  })

  it('takes the stored extension from the bytes, not from the caller', async () => {
    const { fonts } = await createDirectory()
    const stored = await fonts.save(await fixtureBytes())
    expect(stored.id.endsWith('.ttf')).toBe(true)
  })

  it('clears the staging file when the rename cannot land', async () => {
    const { fonts, path } = await createDirectory()
    // A directory sitting where the file belongs: the staging write succeeds,
    // the rename onto it cannot, and the failure has to take the staging file
    // with it — a half-written file is what the next scan would trip over.
    // The pinned uuid in this file makes the random part of the id known.
    const id = 'silkscreen-0000000000004000.ttf'
    await mkdir(join(path, id), { recursive: true })
    await expect(fonts.save(await fixtureBytes())).rejects.toThrow()
    await expect(readdir(path)).resolves.toEqual([id])
  })

  it('lists, reads, and removes a stored font', async () => {
    const { fonts } = await createDirectory()
    const stored = await fonts.save(await fixtureBytes())
    await expect(fonts.list()).resolves.toEqual([stored])
    await expect(fonts.read(stored.id)).resolves.toEqual(await fixtureBytes())
    await expect(fonts.remove(stored.id)).resolves.toBe(true)
    await expect(fonts.list()).resolves.toEqual([])
    await expect(fonts.read(stored.id)).resolves.toBeUndefined()
  })

  it('reports removing an already-absent font as no removal', async () => {
    const { fonts } = await createDirectory()
    await expect(fonts.remove('missing-1234567890abcdef.ttf')).resolves.toBe(false)
  })

  it('refuses to read or remove an id that escapes the directory', async () => {
    const { fonts } = await createDirectory()
    await expect(fonts.read('../settings.yaml')).resolves.toBeUndefined()
    await expect(fonts.remove('../settings.yaml')).resolves.toBe(false)
  })

  it('rejects an upload whose bytes are not a font', async () => {
    const { fonts, path } = await createDirectory()
    await expect(fonts.save(Buffer.from('definitely not a font'))).rejects.toThrow(TypeError)
    await expect(readdir(path)).rejects.toThrow()
  })

  it('rejects a container tag with no readable face', async () => {
    const { fonts } = await createDirectory()
    await expect(fonts.save(Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(64)]))).rejects.toThrow(TypeError)
  })

  it('leaves no staging file behind after a successful store', async () => {
    const { fonts, path } = await createDirectory()
    await fonts.save(await fixtureBytes())
    const entries = await readdir(path)
    expect(entries.some(name => name.endsWith('.staging'))).toBe(false)
  })

  it('reads a file once and answers later listings from what it read', async () => {
    const { fonts, path } = await createDirectory()
    await fonts.ensure()
    // A file this plugin never wrote, so nothing has parsed it yet.
    await writeFile(join(path, 'hand-dropped.ttf'), await fixtureBytes())
    const parse = vi.mocked(readFontFamilies)

    const expected = [{ id: 'hand-dropped.ttf', family: 'Silkscreen' }]
    await expect(fonts.list()).resolves.toEqual(expected)
    expect(parse).toHaveBeenCalledTimes(1)
    // Reading the whole file is what a listing costs, so repeating the listing
    // of an unchanged directory must not repeat it.
    await expect(fonts.list()).resolves.toEqual(expected)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('does not read back a file it just stored', async () => {
    const { fonts } = await createDirectory()
    const stored = await fonts.save(await fixtureBytes())
    const parse = vi.mocked(readFontFamilies)
    parse.mockClear()

    await expect(fonts.list()).resolves.toEqual([stored])
    // An upload parses the bytes it already holds; listing them again would
    // read the file back off disk to learn what it just learned.
    expect(parse).not.toHaveBeenCalled()
  })

  it('reads a file again once its identity moves', async () => {
    const { fonts, path } = await createDirectory()
    const stored = await fonts.save(await fixtureBytes())
    const parse = vi.mocked(readFontFamilies)
    await fonts.list()
    parse.mockClear()

    // Same id, different file: what a hand-copied replacement looks like. The
    // replacement declares a name of the same length, so the size is unchanged
    // and the modification time is the fact that catches it.
    const replaced = join(path, stored.id)
    await writeFile(replaced, await renamedFixture('Zzzzzzzzzz'))
    await utimes(replaced, new Date(), new Date(Date.now() + 2000))
    await expect(fonts.list()).resolves.toEqual([{ id: stored.id, family: 'Zzzzzzzzzz' }])
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('distinguishes a removal that failed from a font that was already gone', async () => {
    const { fonts, path } = await createDirectory()
    await expect(fonts.remove('absent.ttf')).resolves.toBe(false)
    // A directory wearing a stored id: present, and not something `rm` removes
    // without recursing, so the caller has to hear about the failure.
    const id = 'silkscreen-0000000000004000.ttf'
    await fonts.ensure()
    await mkdir(join(path, id))
    await expect(fonts.remove(id)).rejects.toThrow()
  })

  it('forgets a file that was deleted behind its back', async () => {
    const { fonts, path } = await createDirectory()
    const stored = await fonts.save(await fixtureBytes())
    await expect(fonts.list()).resolves.toEqual([stored])
    await rm(join(path, stored.id))
    await expect(fonts.list()).resolves.toEqual([])
    // The name is not resurrected by a later read of the same id.
    await expect(fonts.read(stored.id)).resolves.toBeUndefined()
    await expect(fonts.list()).resolves.toEqual([])
  })

  it('recognises a font file copied into the directory by hand', async () => {
    const { fonts, path } = await createDirectory()
    await fonts.ensure()
    await writeFile(join(path, 'hand-dropped.ttf'), await fixtureBytes())
    await expect(fonts.list()).resolves.toEqual([{ id: 'hand-dropped.ttf', family: 'Silkscreen' }])
  })

  it('skips a non-font file in the directory and reports the skip once', async () => {
    const logger = { warn: vi.fn() }
    const { fonts, path } = await createDirectory(logger)
    await fonts.ensure()
    await writeFile(join(path, 'notes.ttf'), 'this is prose wearing a font extension')
    await writeFile(join(path, 'readme.txt'), 'not a candidate at all')
    const stored = await fonts.save(await fixtureBytes())
    await expect(fonts.list()).resolves.toEqual([stored])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/skipped 1 unreadable files/)
  })

  it('ignores a candidate whose name is not an accepted format', async () => {
    const logger = { warn: vi.fn() }
    const { fonts, path } = await createDirectory(logger)
    await fonts.ensure()
    await writeFile(join(path, 'font.txt'), await fixtureBytes())
    await expect(fonts.list()).resolves.toEqual([])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('sorts the catalogue by family name', async () => {
    const { fonts, path } = await createDirectory()
    await fonts.ensure()
    await writeFile(join(path, 'a.ttf'), await fixtureBytes())
    await writeFile(join(path, 'b.ttf'), await fixtureBytes())
    const listed = await fonts.list()
    expect(listed.map(entry => entry.id)).toEqual(['a.ttf', 'b.ttf'])
  })

  it('creates the directory on demand and reports its absolute path', async () => {
    const { fonts, path } = await createDirectory()
    await expect(fonts.ensure()).resolves.toBe(path)
    expect(fonts.path).toBe(path)
  })
})
