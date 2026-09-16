/**
 * Host half of `dsh-plugin-ui-font-family`. It owns the persisted selection,
 * the two font catalogues, the HTTP routes the settings page uses, and the
 * bootstrap row that installs the chosen font before the shell mounts.
 *
 * This module is also what the client module system discovers: the Loader
 * entry pointing here leads to the nearest `package.json`, whose `dsh.client`
 * and `exports["./client"]` name the browser half. A Loader entry that does
 * not reach this module therefore mounts no browser half either.
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
  FontSettingsSchema,
  validateFontSettings,
  type FontSettings,
} from './font-settings.ts'
import { resolveFontProjection, UNREAD_FONT_CATALOGUES, type FontCatalogues } from './font-selection.ts'
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
export interface ResolvedSpec {
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

  // The bootstrap row is built during a synchronous index render, which cannot
  // await a directory read. The uploaded catalogue is therefore kept warm and
  // refreshed after every write; a render arriving before the first read
  // simply contributes no row.
  let catalogues: FontCatalogues = UNREAD_FONT_CATALOGUES
  const refreshUserFonts = (): void => {
    void userFonts.ensure()
      .then(async () => userFonts.families())
      .then((uploaded) => { catalogues = { uploaded } })
      .catch((error: unknown) => {
        ctx.logger.warn(`ui-font-family: could not read the user font directory ${spec.fontDir}: ${String(error)}`)
      })
  }
  refreshUserFonts()

  // The composition entry supplies the section's base layer, so a profile can
  // pin a house font that every user choice overrides and a reset returns to.
  let currentSettings: () => FontSettings = () => spec.defaultFamily
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(settingsCtx, FONT_SETTINGS_NAMESPACE, FontSettingsSchema, spec.defaultFamily, {
      setSource: (current) => { currentSettings = current },
      // The bootstrap row resolves at render time from `currentSettings`, so a
      // committed change needs no cached derivation re-judged here.
      onChange: () => {},
      validate: validateFontSettings,
    })
  })

  ctx.on('webserver/index-inject', (table) => {
    const uploaded = catalogues.uploaded
    // The declarations are independent of what is selected: they are what makes
    // a stored font paintable at first paint, instead of one client round trip
    // later. The browser adopts this same element for the fonts it uploads.
    if (uploaded !== undefined && uploaded.size > 0) {
      table.push({ kind: 'style', text: fontFaceCss(uploaded) })
    }
    const projection = resolveFontProjection(currentSettings(), catalogues)
    // `unresolved` means a stored font is selected while the catalogue has not
    // been read; `harness` means the selection asks for the harness's own font.
    // Neither contributes a row, and both leave the harness stack in place for
    // this render rather than installing a stack the render cannot justify.
    if (projection.kind !== 'families') return
    table.push(bootFontInjection(projection.families))
  })

  registerFontRoutes(ctx, {
    userFonts,
    systemFonts,
    maxUploadBytes: spec.maxUploadBytes,
    onCatalogChanged: refreshUserFonts,
  })
}

export { FONT_SETTINGS_NAMESPACE, FontSettingsSchema } from './font-settings.ts'
export type { FontSettings, FontSource } from './font-settings.ts'
