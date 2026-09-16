import { coverageConfigDefaults, defineConfig } from 'vitest/config'

/**
 * Test configuration for the plugin. Component specs opt into jsdom with a
 * `// @vitest-environment jsdom` pragma on their first line, so the shared
 * default stays the Node environment the Host-half specs run in.
 *
 * Coverage measures the shipped halves: the specs and their stubs are the
 * instrument, not the artifact, so `tests/` is excluded.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    // Fixtures are real font binaries read by the specs; they are not tests.
    passWithNoTests: false,
    server: {
      deps: {
        // The class-name primitives import their own `.module.css`. Vitest
        // externalizes node_modules by default, which hands that import to
        // Node's ESM loader — it rejects the extension. Transforming the
        // package instead lets Vite stub the stylesheet, which is what the
        // browser shell replaces with the real one anyway.
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
    coverage: {
      // Measure the whole shipped source, not only the modules a spec happens
      // to import, so an uncovered file shows up as a drop rather than as
      // silence. Stylesheets and ambient declarations carry no executable
      // code and are not measured.
      include: ['src/**'],
      exclude: [...coverageConfigDefaults.exclude, 'tests/**', 'src/**/*.module.css', 'src/**/*.d.ts'],
      thresholds: {
        statements: 100,
        functions: 100,
        lines: 100,
        // The remainder is spread over one-line guards whose false arm is
        // unreachable without a hostile Host: font-files, font-routes and the
        // runtime's abort/error paths.
        branches: 96,
      },
    },
  },
})
