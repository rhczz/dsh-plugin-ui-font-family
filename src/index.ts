/**
 * Host half of `dsh-plugin-ui-font-family`: the persisted selection, the two
 * font catalogues, the HTTP routes the settings page calls, and the bootstrap
 * row that installs the chosen font before the shell mounts.
 *
 * The client module system discovers this module: the Loader entry pointing
 * here leads to the nearest `package.json`, whose `dsh.client` and
 * `exports["./client"]` name the browser half. An entry that does not reach
 * this module mounts no browser half either.
 * @module dsh-plugin-ui-font-family
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { bootFontInjection } from './boot-font.ts'
import { fontFaceCss } from './font-face.ts'
import { registerFontRoutes } from './font-routes.ts'
import {
  DEFAULT_FONT_SETTINGS,
  FONT_SETTINGS_NAMESPACE,
  validateFontSettings,
  type FontSettings,
} from './font-settings.ts'
import { FontSettingsSchema } from './font-settings-schema.ts'
import { resolveFontProjection } from './font-selection.ts'
import { platformFontDirs, SystemFontIndex } from './system-fonts.ts'
import { USER_FONT_DIR_NAME, UserFontDirectory } from './user-fonts.ts'

/** Largest accepted upload, before any composition override. */
export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * Required service: the web server this plugin's routes live on. The browser
 * half has nothing to read or write without it, so a profile that serves no
 * web surface leaves this plugin inactive rather than half mounted.
 */
export const inject = ['webServer']

/** Plugin config: where fonts live, what the profile starts with, and the upload limit. */
export interface Config {
  /** User font directory; defaults to `fonts` under the harness home. */
  fontDir?: string
  /** Harness home used when `fontDir` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Extra directories scanned for installed fonts, after the platform ones. */
  systemFontDirs?: string[]
  /** Scan the platform font directories; defaults to true. */
  scanSystemFonts?: boolean
  /** Largest accepted upload in bytes; defaults to {@link DEFAULT_MAX_UPLOAD_BYTES}. */
  maxUploadBytes?: number
  /** Selection this profile starts with, overridden by any user choice. */
  defaultFamily?: FontSettings
}

/** Fully resolved plugin parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  /** Absolute user font directory. */
  fontDir: string
  /**
   * Directories the installed-font index scans: the platform ones unless
   * scanning is off, then every directory the composition named.
   */
  systemFontDirs: readonly string[]
  /** Largest accepted upload in bytes. */
  maxUploadBytes: number
  /** Selection installed as the settings section's composition base. */
  defaultFamily: FontSettings
}

/**
 * Resolve the runtime spec from plugin config.
 *
 * An unusable value fails here, at load, rather than at the first request that
 * would have used it.
 * @param config - raw plugin config.
 * @returns the fully resolved parameters.
 * @throws {TypeError} when a configured value could not be served.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  const maxUploadBytes = config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) {
    throw new TypeError(`ui-font-family: maxUploadBytes must be a positive integer, got ${String(config.maxUploadBytes)}`)
  }
  const defaultFamily = config.defaultFamily ?? DEFAULT_FONT_SETTINGS
  validateFontSettings(defaultFamily)
  return {
    fontDir: config.fontDir ?? join(resolveDshHome(config.dshHome), USER_FONT_DIR_NAME),
    systemFontDirs: [
      // `scanSystemFonts` governs the platform directories only. A directory
      // the composition named explicitly is a deliberate request, so it is
      // scanned whatever the platform default is.
      ...(config.scanSystemFonts === false ? [] : platformFontDirs()),
      ...config.systemFontDirs ?? [],
    ],
    maxUploadBytes,
    defaultFamily,
  }
}

/** Schema of this plugin's composition entry, so a profile gets its values validated. */
export const Config: z<Config> = z.object({
  fontDir: z.string(),
  dshHome: z.string(),
  systemFontDirs: z.array(z.string()),
  scanSystemFonts: z.boolean().default(true),
  maxUploadBytes: z.number().default(DEFAULT_MAX_UPLOAD_BYTES),
  defaultFamily: FontSettingsSchema,
})

/**
 * Register the settings section, the font routes, and the bootstrap row.
 * @param ctx - owning Host context; every registration is an effect it releases.
 * @param config - composition entry for this plugin.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const spec = resolveSpec(config)
  const userFonts = new UserFontDirectory(spec.fontDir, ctx.logger)
  const systemFonts = spec.systemFontDirs.length === 0
    ? undefined
    : new SystemFontIndex(spec.systemFontDirs, ctx.logger)

  // Create the directory at load so a misconfigured path fails there rather
  // than at the first upload.
  void userFonts.ensure().catch((error: unknown) => {
    ctx.logger.warn(`ui-font-family: could not read the user font directory ${spec.fontDir}: ${String(error)}`)
  })

  // The bootstrap row is built during a synchronous index render, which cannot
  // await a file read, so the family of the selected stored font is resolved
  // before the render that needs it. Only selected ids are read.
  const bootFamilies = new Map<string, string | undefined>()
  let currentSettings: () => FontSettings = () => spec.defaultFamily

  /** Read the family of the selected stored font, once per selection. */
  const resolveBootFamily = (): void => {
    const settings = currentSettings()
    if (settings.source !== 'upload' || bootFamilies.has(settings.id)) return
    const id = settings.id
    // Claim the id before the read, so a repeated change reads the file once.
    bootFamilies.set(id, undefined)
    void userFonts.familyOf(id).then((family) => { bootFamilies.set(id, family) })
  }

  /** Forget what earlier reads learned, so the next change reads again. */
  const forgetBootFamily = (): void => {
    bootFamilies.clear()
    resolveBootFamily()
  }

  // The installed-font scan is not warmed here: only a request from this
  // machine can be answered with it.

  // The composition entry supplies the section's base layer, so a profile can
  // pin a house font that every user choice overrides and a reset returns to.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(settingsCtx, FONT_SETTINGS_NAMESPACE, FontSettingsSchema, spec.defaultFamily, {
      setSource: (current) => { currentSettings = current },
      // The service calls this at attach and after every committed change,
      // which is where the selected stored font is read: by the time a page
      // renders, that family is already known.
      onChange: resolveBootFamily,
      validate: validateFontSettings,
    })
  })

  ctx.on('webserver/index-inject', (table) => {
    const settings = currentSettings()
    // Only the selected stored font can paint the first frame. The browser half
    // declares the rest from the catalogue it reads on mount.
    const family = settings.source === 'upload' ? bootFamilies.get(settings.id) : undefined
    const uploaded = family === undefined ? undefined : new Map([[settings.id, family]])
    const projection = resolveFontProjection(settings, { uploaded })
    // `unresolved` and `harness` both leave the harness stack in place: neither
    // family is one this render can justify installing.
    if (projection.kind !== 'families') return
    if (uploaded !== undefined) table.push({ kind: 'style', text: fontFaceCss(uploaded) })
    table.push(bootFontInjection(projection.families))
  })

  registerFontRoutes(ctx, {
    userFonts,
    systemFonts,
    maxUploadBytes: spec.maxUploadBytes,
    onCatalogChanged: forgetBootFamily,
  })
}

export { FONT_SETTINGS_NAMESPACE } from './font-settings.ts'
export { FontSettingsSchema } from './font-settings-schema.ts'
export type { FontSettings, FontSource } from './font-settings.ts'
