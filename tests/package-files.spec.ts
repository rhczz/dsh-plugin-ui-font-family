/**
 * Packaging cover for the published tarball. `files` has to ship every module
 * the declared entries reach through relative imports, not just the entries:
 * a barrel published without its siblings installs a plugin that throws
 * MODULE_NOT_FOUND on its first import, and no spec over `src/` can see that.
 *
 * The walk reads `lib/`, so `pnpm build` has to have run — CI builds before it
 * tests for exactly this reason.
 * @module dsh-plugin-ui-font-family/tests/package-files
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PLATFORM_MODULES } from '../tsdown.config.ts'

/** Package root, one level above this spec. */
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The manifest fields packaging reads. */
interface Manifest {
  main?: string
  files?: string[]
  exports?: Record<string, unknown>
  dsh?: { bundle?: { patch?: string } }
}

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as Manifest

/** Relative import or re-export specifiers in one emitted module. */
const RELATIVE_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.[^'"]+)['"]/g

/** Characters that mean something to a regular expression. */
const REGEXP_SPECIAL = /[.+^${}()|[\]\\]/

/**
 * Translate one `files` pattern into the matcher npm applies: `**` spans
 * directories, `*` and `?` stay inside one path segment.
 * @param pattern - pattern as written in the manifest.
 * @returns the equivalent anchored regular expression.
 */
function toRegExp(pattern: string): RegExp {
  let body = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] !== '*') {
        body += '[^/]*'
        continue
      }
      index += 1
      // `**/` spans whole directories; a `**` with nothing after it spans all.
      if (pattern[index + 1] === '/') {
        index += 1
        body += '(?:[^/]+/)*'
      } else {
        body += '.*'
      }
      continue
    }
    if (char === '?') {
      body += '[^/]'
      continue
    }
    body += char !== undefined && REGEXP_SPECIAL.test(char) ? `\\${char}` : char
  }
  return new RegExp(`^${body}$`)
}

/**
 * @param entry - package-relative path.
 * @returns whether the manifest's `files` ships it.
 */
function shipped(entry: string): boolean {
  return (manifest.files ?? []).some(pattern => toRegExp(pattern).test(entry))
}

/**
 * Every path an `exports` map points at, in both the plain-string and the
 * conditional forms.
 * @param value - one `exports` value.
 * @returns the targets it names.
 */
function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  return Object.values(value as Record<string, unknown>).flatMap(exportTargets)
}

/** Every path this package declares as an entry. */
const ENTRIES = [
  ...(manifest.main === undefined ? [] : [manifest.main]),
  ...exportTargets(manifest.exports),
  ...(manifest.dsh?.bundle?.patch === undefined ? [] : [manifest.dsh.bundle.patch]),
].map(entry => entry.replace(/^\.\//, ''))
  // npm ships the manifest, the README and the licence whatever `files` says.
  .filter(entry => entry !== 'package.json')

/**
 * Walk the relative imports of every entry, the way a runtime resolver would.
 * @param entries - package-relative entry paths.
 * @returns every reached module, entries included.
 */
function reachableModules(entries: string[]): string[] {
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.shift()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(resolve(ROOT, file), 'utf8')
    for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
      const specifier = match[1]
      if (specifier === undefined) continue
      queue.push(resolve('/', dirname(file), specifier).slice(1))
    }
  }
  return [...seen]
}

describe('the published file set', () => {
  it('declares the entries this package loads', () => {
    expect(ENTRIES).toContain('lib/index.js')
    expect(ENTRIES).toContain('lib/client.js')
    expect(ENTRIES).toContain('cordis.patch.yml')
  })

  it('ships every declared entry', () => {
    for (const entry of ENTRIES) {
      expect(existsSync(resolve(ROOT, entry)), `${entry} is missing — run pnpm build`).toBe(true)
      expect(shipped(entry), `${entry} is not matched by files`).toBe(true)
    }
  })

  it('ships every module those entries import', () => {
    const reachable = reachableModules(ENTRIES.filter(entry => entry.endsWith('.js')))
    const missing = reachable.filter(file => !shipped(file))
    expect(missing).toEqual([])
  })

  it('reaches more than the barrel, so the import walk above has teeth', () => {
    expect(reachableModules(['lib/index.js']).length).toBeGreaterThan(1)
  })
})

/**
 * Specifiers one bundle requires through the injected `require`.
 * @param bundle - emitted artifact text.
 * @returns every distinct specifier, in first-use order.
 */
function requiredSpecifiers(bundle: string): string[] {
  const found = [...bundle.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map(match => match[1])
    .filter((specifier): specifier is string => specifier !== undefined)
  return [...new Set(found)]
}

/**
 * Modules one bundle carries a copy of although they belong to the shell.
 * @param bundle - emitted artifact text.
 * @returns the offending region labels, empty when the bundle carries none.
 */
function inlinedSharedModules(bundle: string): string[] {
  return [...bundle.matchAll(/\/\/#region ([^\n]*)/g)]
    .map(match => match[1] ?? '')
    .filter(region => /@deepseek-ai[/+]dsh-client-|@deepseek-ai[/+]cordis[@/]/.test(region))
}

/**
 * The client artifact runs inside the page's module system, which resolves the
 * shared module table and nothing else. The official preset rejects a value
 * import from another client package at build time; this package reproduces the
 * artifact format by hand, so the same rule is asserted here, against what
 * actually ships.
 */
describe('the browser bundle', () => {
  const bundle = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')

  it('requires only specifiers the shell module table provides', () => {
    // A specifier outside the table throws the moment the factory runs, which
    // is before the plugin contributes anything.
    expect(requiredSpecifiers(bundle).filter(name => !PLATFORM_MODULES.includes(name))).toEqual([])
  })

  it('finds a specifier the table does not provide, so the check above has teeth', () => {
    const foreign = 'var x = require("@deepseek-ai/dsh-client-ui-theme/client")'
    expect(requiredSpecifiers(foreign).filter(name => !PLATFORM_MODULES.includes(name))).toEqual([
      '@deepseek-ai/dsh-client-ui-theme/client',
    ])
  })

  it('inlines no second copy of a client package or of cordis', () => {
    // Inlining one would hand this plugin a private copy of a service class or
    // a shared symbol rather than the instance the shell holds.
    expect(inlinedSharedModules(bundle)).toEqual([])
  })

  it('recognises an inlined copy, so the check above has teeth', () => {
    const inlined = '//#region node_modules/.pnpm/@deepseek-ai+dsh-client-store@1/node_modules/@deepseek-ai/dsh-client-store/lib/index.js'
    expect(inlinedSharedModules(inlined)).toEqual([inlined.slice('//#region '.length)])
    expect(inlinedSharedModules('//#region node_modules/clsx/dist/clsx.mjs')).toEqual([])
  })
})
