// CSS Modules declarations. Every client package carries its own copy, matching
// packages/client/ui-theme/src/css-modules.d.ts, because ambient CSS
// declarations do not travel with an npm package.
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'

declare module '*.css?inline' {
  const css: string
  export default css
}
