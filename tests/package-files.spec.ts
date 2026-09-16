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

/**
 * Translate one `files` pattern into the matcher npm applies: `**` spans
 * directories, `*` and `?` stay inside one.
 * @param pattern - pattern as written in the manifest.
 * @returns the equivalent anchored regular expression.
 */
function toRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/|\*\*|\*/g, match => (match === '**/' ? '\u0000' : match === '**' ? '\u0001' : '\u0002'))
    .replace(/\u0000/g, '(?:[^/]+/)*')
    .replace(/\u0001/g, '.*')
    .replace(/\u0002/g, '[^/]*')
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
