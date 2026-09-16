/**
 * Font container formats this plugin accepts. Kept apart from the Host's file
 * reading so the browser half can offer the same list in its file picker
 * without pulling a font parser into the client bundle.
 * @module dsh-plugin-ui-font-family/font-formats
 */

/** Extensions accepted for upload and for scanning the user font directory. */
export const FONT_FILE_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.ttc'] as const

/** One of {@link FONT_FILE_EXTENSIONS}. */
export type FontFileExtension = typeof FONT_FILE_EXTENSIONS[number]
