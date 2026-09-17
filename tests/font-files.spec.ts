import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  acceptedFontFileExtension,
  detectFontFileExtension,
  fontFileExtension,
  isFontFileName,
  readFontFamilies,
  sanitizeFamilyName,
} from '../src/font-files.ts'
import { FONT_FILE_EXTENSIONS } from '../src/font-formats.ts'

/** OFL-licensed fixture; its name table declares the family "Silkscreen". */
const FIXTURE = fileURLToPath(new URL('./fixtures/Silkscreen-Regular.ttf', import.meta.url))

/** First bytes of a TrueType file, enough for the container tag. */
const TRUETYPE_HEAD = Buffer.from([0x00, 0x01, 0x00, 0x00])

/** First bytes of a font collection: version 1.0 and one contained face. */
const COLLECTION_HEAD = Buffer.from([0x74, 0x74, 0x63, 0x66, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])

/**
 * Wrap a single font in a collection, the way a `.ttc` carries its faces.
 *
 * A collection header is 12 bytes plus one offset per face, so wrapping shifts
 * every table by that length; the table directory holds absolute offsets and is
 * rewritten to match. The fixture is a real font, so the wrapped result parses
 * through the same reader the plugin uses.
 * @param single - complete bytes of one font.
 * @returns the collection bytes.
 */
function asCollection(single: Buffer): Buffer {
  const head = Buffer.alloc(COLLECTION_HEAD.length + 4)
  COLLECTION_HEAD.copy(head)
  head.writeUInt32BE(head.length, COLLECTION_HEAD.length)
  const wrapped = Buffer.concat([head, single])
  const tables = single.readUInt16BE(4)
  for (let index = 0; index < tables; index += 1) {
    const record = head.length + 12 + index * 16
    wrapped.writeUInt32BE(wrapped.readUInt32BE(record + 8) + head.length, record + 8)
  }
  return wrapped
}

/**
 * Build a buffer whose first four bytes carry `tag` as latin1.
 * @param tag - four-character container tag.
 * @returns the tag padded to the four bytes the detector reads.
 */
function tagBytes(tag: string): Buffer {
  return Buffer.concat([Buffer.from(tag, 'latin1'), Buffer.alloc(8)])
}

describe('file name extensions', () => {
  it('reads a lower-cased extension', () => {
    expect(fontFileExtension('Silkscreen.TTF')).toBe('.ttf')
    expect(fontFileExtension('a/b/c.woff2')).toBe('.woff2')
  })

  it('reports no extension for a dotless or dotfile name', () => {
    expect(fontFileExtension('README')).toBeUndefined()
    expect(fontFileExtension('.ttf')).toBeUndefined()
  })

  it('accepts exactly the declared formats', () => {
    for (const extension of FONT_FILE_EXTENSIONS) {
      expect(acceptedFontFileExtension(`Face${extension.toUpperCase()}`)).toBe(extension)
      expect(isFontFileName(`Face${extension}`)).toBe(true)
    }
  })

  it('rejects a name that is not a font format', () => {
    expect(acceptedFontFileExtension('notes.txt')).toBeUndefined()
    expect(isFontFileName('archive.zip')).toBe(false)
    expect(isFontFileName('face.ttf.bak')).toBe(false)
  })
})

describe('detectFontFileExtension', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['a TrueType file', '\u0000\u0001\u0000\u0000', '.ttf'],
    ['a TrueType file with the true tag', 'true', '.ttf'],
    ['a CFF-flavoured OpenType file', 'OTTO', '.otf'],
    ['a font collection', 'ttcf', '.ttc'],
    ['a WOFF file', 'wOFF', '.woff'],
    ['a WOFF2 file', 'wOF2', '.woff2'],
  ]

  for (const [name, tag, expected] of cases) {
    it(`identifies ${name}`, () => {
      expect(detectFontFileExtension(tagBytes(tag))).toBe(expected)
    })
  }

  it('reports nothing for a tag that is not a font', () => {
    expect(detectFontFileExtension(tagBytes('PK\u0003\u0004'))).toBeUndefined()
    expect(detectFontFileExtension(Buffer.from('hello world'))).toBeUndefined()
  })

  it('reports nothing for a buffer too short to carry a tag', () => {
    expect(detectFontFileExtension(Buffer.alloc(0))).toBeUndefined()
    expect(detectFontFileExtension(TRUETYPE_HEAD.subarray(0, 3))).toBeUndefined()
  })

  it('reads the real fixture as TrueType', async () => {
    expect(detectFontFileExtension(await readFile(FIXTURE))).toBe('.ttf')
  })
})

describe('readFontFamilies', () => {
  it('reads the family name a real font declares', async () => {
    expect(readFontFamilies(await readFile(FIXTURE))[0]).toBe('Silkscreen')
  })

  it('takes the extension from the bytes, not from what a caller claims', async () => {
    // The same bytes reached through a name that lies still identify as TrueType.
    const bytes = await readFile(FIXTURE)
    expect(detectFontFileExtension(bytes)).toBe('.ttf')
  })

  it('reads every face of a collection', async () => {
    const collection = asCollection(await readFile(FIXTURE))
    expect(detectFontFileExtension(collection)).toBe('.ttc')
    expect(readFontFamilies(collection)).toEqual(['Silkscreen'])
  })

  it('rejects bytes that are not a font', () => {
    expect(() => readFontFamilies(Buffer.from('this is not a font, it is prose'))).toThrow()
  })

  it('rejects an empty buffer', () => {
    expect(() => readFontFamilies(Buffer.alloc(0))).toThrow()
  })

  it('rejects a container tag with no readable tables behind it', () => {
    expect(() => readFontFamilies(Buffer.concat([TRUETYPE_HEAD, Buffer.alloc(64)]))).toThrow()
  })

  it('rejects a font whose name table declares nothing usable', async () => {
    // Blanking every encoding of the declared name leaves a container this
    // build reads perfectly well and a family name that sanitizes away, which
    // is the case the guard exists for.
    const bytes = Buffer.from(await readFile(FIXTURE))
    for (const encoding of ['latin1', 'utf16le'] as const) {
      const needle = Buffer.from('Silkscreen', encoding)
      for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + needle.length)) {
        bytes.fill(0, at, at + needle.length)
      }
    }
    expect(detectFontFileExtension(bytes)).toBe('.ttf')
    expect(() => readFontFamilies(bytes)).toThrow(/no usable family name/)
  })
})

describe('sanitizeFamilyName', () => {
  it('keeps a name a font legitimately declares', () => {
    for (const name of ['Silkscreen', 'Brioso Pro', 'Noto Sans CJK SC', 'Source Han Sans CN']) {
      expect(sanitizeFamilyName(name)).toBe(name)
    }
  })

  it('collapses the whitespace a name table can carry', () => {
    expect(sanitizeFamilyName('  Brioso\n Pro \t')).toBe('Brioso Pro')
  })

  it('removes what would end a declaration once the name reaches a stylesheet', () => {
    // The name table is file-controlled content: a brace, semicolon, or angle
    // bracket reaching a stylesheet writes rules of its own.
    expect(sanitizeFamilyName('Evil;} body{display:none}')).toBe('Evil body display:none')
    expect(sanitizeFamilyName('</style><script>alert(1)</script>')).not.toMatch(/[<>]/)
  })

  it('removes a backslash, which would otherwise escape the quote around the name', () => {
    // A quoted CSS string ends at the first unescaped quote; a trailing
    // backslash escapes it and swallows every declaration after this one.
    expect(sanitizeFamilyName('Evil\\')).toBe('Evil')
    expect(sanitizeFamilyName('Back\\slash')).toBe('Back slash')
  })

  it('drops control characters', () => {
    expect(sanitizeFamilyName('Alpha\u0000\u0007Beta')).toBe('Alpha Beta')
  })

  it('leaves nothing behind for a name that is only separators', () => {
    expect(sanitizeFamilyName('{};<>')).toBe('')
  })
})
