/**
 * Build configuration. It emits the lazy CJS factory the client module system
 * loads, in place of the shared `clientBundle()` preset: that preset resolves
 * the package manifest by globbing `packages/<group>/<pkg>/package.json`, which
 * never matches a package outside the repository.
 *
 * The artifact holds two requirements; a page fails to load it silently if
 * either is broken:
 *
 * 1. Loading it registers the factory on `window.__ModuleLoader__` and nothing
 *    else; business side effects wait for the first `require` of the module.
 * 2. It may `require` only specifiers the shared module table carries. Every
 *    other dependency is inlined.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig, type TsdownPlugin } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * Module id the artifact registers. It equals the manifest `name`, because the
 * module table resolves the row by package name; it is read from the manifest
 * so a rename needs no edit here.
 */
const PACKAGE_ID: string = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).name

/**
 * Browser module table, kept equal to `PLATFORM_MODULES` in
 * `packages/client/web/src/platform.ts`. These specifiers stay `require()`
 * calls in the artifact and resolve to the shell's single instance; everything
 * else, third-party libraries included, is inlined.
 *
 * The names here are supplied by the shell at run time, so they are not
 * dependencies of this package. The build and `tests/package-files.spec.ts`
 * read this one exported list, so the artifact and the assertion cannot drift
 * apart.
 */
export const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * Virtual module id prefixes. The suffix is `.mjs` rather than `.css` because
 * tsdown's own CSS pipeline claims ids ending in `.css` unless `@tsdown/css` is
 * installed.
 */
const CSS_MODULE_PREFIX = '\0dsh-plugin-css-module:'
const CSS_GLOBAL_PREFIX = '\0dsh-plugin-css-global:'
const CSS_INLINE_PREFIX = '\0dsh-plugin-css-inline:'
const VIRTUAL_SUFFIX = '.mjs'

/** Resolve a virtual id back to the stylesheet path on disk. */
function assetPath(source: string, importer: string | undefined): string {
  return importer === undefined ? source : resolvePath(dirname(importer), source)
}

/**
 * Build the module source that injects one stylesheet and optionally exports
 * its class-name map.
 *
 * Injection is idempotent: the `data-plugin-css` marker keeps a repeated
 * factory call from adding a second `<style>`, and it records which plugin owns
 * the element for unload and diagnosis.
 * @param id - owning package name, written to `data-plugin`.
 * @param fileId - absolute stylesheet path, used for the deduplication marker.
 * @param css - compiled CSS text.
 * @param classMap - CSS Modules original-to-hashed class names; omitted for a
 * global stylesheet.
 * @returns the module source for this stylesheet.
 */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/**
 * Handle the three stylesheet import forms the shared preset defines:
 * `x.module.css` exports hashed class names and injects, `x.css` injects as a
 * global sheet, and `x.css?inline` exports compiled CSS text without injecting.
 * Each registers the real stylesheet through `this.addWatchFile`, without which
 * the virtual id hides stylesheet edits from the watcher.
 * @returns the tsdown plugins, one per import form.
 */
function cssPlugins(id: string): TsdownPlugin[] {
  return [
    {
      name: 'dsh-plugin-css-modules-inline',
      resolveId(source, importer) {
        if (!source.endsWith('.module.css')) return null
        return CSS_MODULE_PREFIX + assetPath(source, importer) + VIRTUAL_SUFFIX
      },
      async load(virtualId) {
        if (!virtualId.startsWith(CSS_MODULE_PREFIX)) return null
        const fileId = virtualId.slice(CSS_MODULE_PREFIX.length, -VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        // Sorted so the artifact is stable: the export key order is not.
        const classMap: Record<string, string> = {}
        const entries = Object.entries(cssExports ?? {})
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        for (const [local, exported] of entries) classMap[local] = exported.name
        return styleInjectionModule(id, fileId, code.toString(), classMap)
      },
    },
    {
      name: 'dsh-plugin-css-global-inline',
      resolveId(source, importer) {
        if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
        return CSS_GLOBAL_PREFIX + assetPath(source, importer) + VIRTUAL_SUFFIX
      },
      async load(virtualId) {
        if (!virtualId.startsWith(CSS_GLOBAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_GLOBAL_PREFIX.length, -VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const { code } = transform({ filename: fileId, code: await readFile(fileId), minify: true })
        return styleInjectionModule(id, fileId, code.toString())
      },
    },
    {
      name: 'dsh-plugin-css-text-inline',
      resolveId(source, importer) {
        if (!source.endsWith('.css?inline')) return null
        const stylesheet = source.slice(0, -'?inline'.length)
        return CSS_INLINE_PREFIX + assetPath(stylesheet, importer) + VIRTUAL_SUFFIX
      },
      async load(virtualId) {
        if (!virtualId.startsWith(CSS_INLINE_PREFIX)) return null
        const fileId = virtualId.slice(CSS_INLINE_PREFIX.length, -VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const { code } = transform({ filename: fileId, code: await readFile(fileId), minify: true })
        return `export default ${JSON.stringify(code.toString())};`
      },
    },
  ]
}

/** Whether the module table supplies this specifier, keeping it external. */
function isPlatformModule(specifier: string): boolean {
  return PLATFORM_MODULES.includes(specifier)
}

export default defineConfig({
  name: `${PACKAGE_ID}/client`,
  // Built from source: no tsc intermediate, and the sourcemap points at src.
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // tsc emits the types into lib/; dts here would wrap the banner into a .d.cts.
  dts: false,
  sourcemap: true,
  // tsc runs first and emits into the same lib/, so nothing may be cleaned.
  clean: false,
  deps: {
    neverBundle: isPlatformModule,
    alwaysBundle: (specifier: string) => !isPlatformModule(specifier),
  },
  // Inlined libraries read these compile-time variables (zustand and immer read
  // NODE_ENV, zustand also probes import.meta.env). A CJS artifact carries no
  // import.meta, so an unreplaced read throws when the factory runs.
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: cssPlugins(PACKAGE_ID),
  outputOptions: {
    entryFileNames: 'client.js',
    // The lazy factory: the module body registers the factory, and the plugin's
    // own code runs when the factory is required.
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
