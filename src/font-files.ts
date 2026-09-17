/**
 * Reading font files on the Host. One module owns the accepted extensions and
 * the family name extraction, so upload validation and directory scanning
 * cannot drift apart on what counts as a font.
 * @module dsh-plugin-ui-font-family/font-files
 */

import { create } from 'fontkit'
import type { Font, FontCollection } from 'fontkit'
import { FONT_FILE_EXTENSIONS, type FontFileExtension } from './font-formats.ts'
import { isUnsafeFamilyNameCharacter } from './font-settings.ts'

/** Reports what a font file operation skipped, so a skip is never silent. */
export interface FontFileLogger {
  /**
   * Record files or directories a font operation could not use.
   * @param message - one line naming what was skipped and why.
   */
  warn(message: string): void
}

/**
 * Judge whether a read failed because the entry is not there. A platform
 * directory this machine does not have is an ordinary absence, not a fault.
 * @param error - error a directory or file read rejected with.
 * @returns whether the entry was absent.
 */
export function isMissingEntry(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Read the lower-case extension of a file name.
 * @param name - file name or path.
 * @returns the extension including its dot, or undefined when the name has none.
 */
export function fontFileExtension(name: string): string | undefined {
  const index = name.lastIndexOf('.')
  return index <= 0 ? undefined : name.slice(index).toLowerCase()
}

/**
 * Read the accepted extension of a file name.
 * @param name - file name or path.
 * @returns the extension including its dot, or undefined when the name carries
 * one this plugin does not accept.
 */
export function acceptedFontFileExtension(name: string): FontFileExtension | undefined {
  const extension = fontFileExtension(name)
  return FONT_FILE_EXTENSIONS.find(accepted => accepted === extension)
}

/**
 * Test a file name for carrying an extension this plugin accepts.
 * @param name - file name or path.
 * @returns whether the extension is one of {@link FONT_FILE_EXTENSIONS}.
 */
export function isFontFileName(name: string): boolean {
  return acceptedFontFileExtension(name) !== undefined
}

/**
 * Leading tag of each container this plugin accepts, paired with the extension
 * a stored file of that container gets. Read as latin1 so the comparison is
 * byte-exact.
 */
const FONT_FILE_MAGIC: readonly (readonly [string, FontFileExtension])[] = [
  ['\u0000\u0001\u0000\u0000', '.ttf'],
  ['true', '.ttf'],
  ['OTTO', '.otf'],
  ['ttcf', '.ttc'],
  ['wOFF', '.woff'],
  ['wOF2', '.woff2'],
]

/**
 * Identify a font container from its leading bytes.
 *
 * An upload carries no trustworthy file name, so the stored extension comes
 * from the bytes themselves rather than from anything the client claims.
 * @param bytes - complete file contents.
 * @returns the matching extension, or undefined when the tag is not a font.
 */
export function detectFontFileExtension(bytes: Buffer): FontFileExtension | undefined {
  if (bytes.length < 4) return undefined
  const tag = bytes.toString('latin1', 0, 4)
  return FONT_FILE_MAGIC.find(([magic]) => magic === tag)?.[1]
}

/** Distinguish a font collection from a single face. */
function isFontCollection(font: Font | FontCollection): font is FontCollection {
  return 'fonts' in font
}

/**
 * Reduce a declared family name to one that can be written into CSS safely.
 *
 * The name table is file-controlled content and the name is written into a
 * stylesheet, where a brace or semicolon ends the declaration and a backslash
 * escapes the closing quote. Every refused character becomes a space, and the
 * result is what both `@font-face` and the font stack name, so the two agree. A
 * sanitized name also satisfies {@link isUsableFontFamilyName} unchanged.
 * @param declared - family name as the font declares it.
 * @returns the usable name, empty when nothing survives.
 */
export function sanitizeFamilyName(declared: string): string {
  let cleaned = ''
  for (const character of declared) {
    cleaned += isUnsafeFamilyNameCharacter(character) ? ' ' : character
  }
  return cleaned.replaceAll(/\s+/g, ' ').trim()
}

/**
 * Extract the family names a font file declares. The extension allowlist only
 * narrows what is offered; this parse decides whether the bytes are a font. A
 * collection reports one entry per contained face.
 * @param bytes - complete file contents. WOFF and WOFF2 are read through the
 * decompression fontkit performs; the caller needs no container step.
 * @returns declared family names in face order, deduplicated and reduced to
 * {@link sanitizeFamilyName}. The tuple type carries the non-emptiness proved
 * below.
 * @throws {TypeError} when the bytes are not a font this build can read, or when
 * no face declares a usable family name. An upload reports this as its rejection
 * reason; a scan skips the file.
 */
export function readFontFamilies(bytes: Buffer): readonly [string, ...string[]] {
  const font = create(bytes)
  const faces: readonly Font[] = isFontCollection(font) ? font.fonts : [font]
  const families = new Set<string>()
  for (const face of faces) {
    const family = sanitizeFamilyName(face.familyName)
    if (family !== '') families.add(family)
  }
  if (families.size === 0) {
    throw new TypeError('font file declares no usable family name')
  }
  return [...families] as [string, ...string[]]
}
