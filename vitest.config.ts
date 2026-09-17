import { coverageConfigDefaults, defineConfig } from 'vitest/config'

/**
 * Test configuration. Component specs opt into jsdom with a
 * `// @vitest-environment jsdom` pragma on their first line, so the default
 * environment stays the Node one the Host-half specs run in.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    passWithNoTests: false,
    server: {
      deps: {
        // The class-name primitives import their own `.module.css`. Vitest
        // externalizes node_modules by default, which hands that import to
        // Node's ESM loader, and it rejects the extension; transforming the
        // package lets Vite stub the stylesheet, as the browser shell does.
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
    coverage: {
      // Measure every shipped source file, not only the ones a spec imports,
      // so an uncovered file shows up as a drop. Stylesheets and ambient
      // declarations carry no executable code and are excluded.
      include: ['src/**'],
      exclude: [...coverageConfigDefaults.exclude, 'tests/**', 'src/**/*.module.css', 'src/**/*.d.ts'],
      thresholds: {
        // Every file, every counter: the harness coverage gate a moved-in
        // package has to satisfy.
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
