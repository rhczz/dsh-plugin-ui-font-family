/**
 * 打包配置：产出客户端模块系统要求的「惰性 CJS 工厂」构件。
 *
 * 为什么不能直接用官方共享预设 `clientBundle()`：
 * 那个预设内部要用 globSync 扫 `packages/<组>/<包>/package.json` 查包清单来算 external，
 * 仓库外的包不在这个 glob 里，会直接抛
 * 「tsdown: no packages/<组>/<包>/package.json declares the name ...」。
 * 官方 cookbook（docs/cookbook/adding-a-settings-card.md 的 Packaging 一节）也写明了：
 * 没有对外发布的预设，仓库外的包必须自己复现同样的产物格式。
 *
 * 产物必须满足两条硬约束，否则页面加载时会静默失败：
 * 1. 执行时只做一件事——把工厂注册进 window.__ModuleLoader__，
 *    业务副作用延迟到该模块第一次被 require（所以用 banner/footer，不是普通入口）。
 * 2. 只能 require 模块表里存在的 specifier；表外的依赖必须内联，
 *    否则 require 当场抛错。
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig, type TsdownPlugin } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * 产物里注册的模块 id。
 * 必须等于 package.json 的 name：模块表按包名解析这一行，
 * 两边不一致会让别的插件 require 不到你（或反之）。
 * 所以这里从清单读，改包名不用改构建配置。
 */
const PACKAGE_ID: string = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).name

/**
 * 浏览器端共享模块表（shell 预置的 external 基线）。
 * 与 packages/client/web/src/platform.ts 的 PLATFORM_MODULES 保持一致：
 * 这些 specifier 在产物里保留成 require()，由模块表提供同一份实例；
 * 其余一切（含第三方库）都内联进本 bundle。
 *
 * 注意：这张表里的名字不要写进 package.json 的 dependencies——
 * 它们是运行时由 shell 提供的，不是本包安装的依赖。
 */
const PLATFORM_MODULES: readonly string[] = [
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
 * 虚拟模块 id 前缀。后缀必须是 .mjs 而不是 .css：
 * tsdown 自己的 CSS 管线会拦截以 .css 结尾的 id（那需要额外装 @tsdown/css），
 * 加个后缀把路径绕开它。
 */
const CSS_MODULE_PREFIX = '\0dsh-plugin-css-module:'
const CSS_GLOBAL_PREFIX = '\0dsh-plugin-css-global:'
const CSS_INLINE_PREFIX = '\0dsh-plugin-css-inline:'
const VIRTUAL_SUFFIX = '.mjs'

/** 把虚拟 id 还原成磁盘上的真实样式表路径。 */
function assetPath(source: string, importer: string | undefined): string {
  return importer === undefined ? source : resolvePath(dirname(importer), source)
}

/**
 * 生成「注入样式 + 可选导出类名映射」的 JS 模块源码。
 *
 * 注入是幂等的：用 data-plugin-css 做标记，重复执行同一个工厂不会插第二份 <style>。
 * 标记同时是本插件的样式归属证明（卸载/排查时按 data-plugin 找）。
 * @param id - 归属插件的包名，写进 data-plugin。
 * @param fileId - 样式表绝对路径，用于生成去重标记。
 * @param css - 已编译好的 CSS 文本。
 * @param classMap - CSS Modules 的「原名 → 哈希名」映射；省略时是全局样式。
 * @returns 该样式表对应的模块源码。
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
 * 三种样式导入的处理规则，与官方预设语义一致：
 * - `x.module.css` → 默认导出哈希后的类名映射，并注入样式
 * - `x.css`        → 全局样式，只注入
 * - `x.css?inline` → 默认导出编译后的 CSS 文本，不注入（给需要自己管生命周期的场景）
 * 三者都通过 this.addWatchFile 把真实样式表登记进监听图，
 * 否则虚拟 id 会让热更新漏掉样式改动。
 * @returns 三个 rolldown/tsdown 插件。
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
        // 排序只为让产物稳定（对象键序随实现变化会让 diff 抖动、缓存失效）。
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

/** 该 specifier 由模块表提供（保持 external），还是内联进 bundle。 */
function isPlatformModule(specifier: string): boolean {
  return PLATFORM_MODULES.includes(specifier)
}

export default defineConfig({
  name: `${PACKAGE_ID}/client`,
  // 直接从源码构建：仓库外的包不必先让 tsc 产出中间 JS，
  // 这样 sourcemap 也直接指向 src，浏览器里调试更直观。
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // 类型由 tsc 产出到 lib/ 下；这里开 dts 会把 banner/footer 包进 .d.cts 导致解析失败。
  dts: false,
  sourcemap: true,
  // tsc 先跑，它的产物就在同一个 lib/ 目录里，绝不能被清掉。
  clean: false,
  deps: {
    neverBundle: isPlatformModule,
    alwaysBundle: (specifier: string) => !isPlatformModule(specifier),
  },
  // 内联进来的第三方库常读这些编译期变量（zustand/immer 读 NODE_ENV，
  // zustand 还会探测 import.meta.env）。CJS 产物带不了 import.meta，
  // 不替换就会在工厂执行时抛 ReferenceError。
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: cssPlugins(PACKAGE_ID),
  outputOptions: {
    entryFileNames: 'client.js',
    // 这三行就是「惰性 CJS 工厂」的全部秘密：
    // 模块顶层只调用 __ModuleLoader__.load 注册工厂，
    // 真正的业务代码在 factory 被 require 时才执行。
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
