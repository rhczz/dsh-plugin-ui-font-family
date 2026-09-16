# 开发与维护

本文件是 `dsh-plugin-ui-font-family` 的维护者文档：构建、测试、内部设计约束、踩过的坑。
面向用户的功能介绍、安装和配置见 [README.md](README.md)。

## 挂载（开发用）

在 dsh 仓库根目录用 `--patch` 挂上源码，不碰任何 profile 文件：

```sh
pnpm dsh web --patch dsh-plugin-ui-font-family/cordis.yaml --port 3082
```

`--port` 必须显式给（否则会和已经在跑的实例抢端口），`--patch` 要放在 app 自己的参数前面。
`cordis.yaml` 指 `./src/index.ts`（tsx 直接跑源码）；`cordis.patch.yml` 是同一行的
bundle 覆盖层，指包名，给 `dsh plugin add` 装好之后用。

## 环境要求

- 一个可运行的 DeepSeek Harness 源码检出（`cordis.yaml` 通过 `--patch` 挂到它的 web profile）
- Node `^22.19 || >=24`
- 本插件自己的依赖：`pnpm install`

### 版本对齐（重要）

`devDependencies` / `peerDependencies` 里的 `@deepseek-ai/dsh-*` 与 `@deepseek-ai/cordis`
是**开发期**依赖：编译类型和构建工具用得到，运行时由 dsh 自己的模块表提供。
它们必须和你要挂载的那份 dsh 同一条版本线。

当前对齐的是 `0.1.6-alpha.1`（npm 上的 `alpha` dist-tag；`latest` 是另一条更早的线，
不要按 `latest` 装）。

如果本地检出里有**尚未发布**的改动，不要从 npm 装，改成链接到检出：

```sh
DSH=/path/to/deepseek-harness   # 你的 dsh 检出根目录
pnpm add -D link:$DSH/vendor/cordis \
             link:$DSH/packages/util/home-paths \
             link:$DSH/packages/host/webserver \
             link:$DSH/packages/settings/settings \
             link:$DSH/packages/client/locale \
             link:$DSH/packages/client/store \
             link:$DSH/packages/client/ui-primitives \
             link:$DSH/packages/client/ui-renderer \
             link:$DSH/packages/client/ui-settings \
             link:$DSH/packages/client/ui-slots
```

## 构建与测试

```sh
pnpm install
pnpm run build          # tsc 产出 lib/**，tsdown 产出 lib/client.js
pnpm run typecheck      # Host 半边 + 测试一起查
pnpm run lint           # oxlint
pnpm test               # vitest
pnpm run test:coverage  # CI 用的门禁：语句/函数/行 100%、分支 96%
```

**先 `build` 再 `test`**：`tests/package-files.spec.ts` 走的是 `lib/`，它检查 `files`
是否把入口 import 到的每个模块都打进了包里——这条用例来自一次真实事故：`files` 只写了
`lib/index.js`，装完的插件在第一次 import 就 `MODULE_NOT_FOUND`。在干净检出上直接
`pnpm test` 会因为 `lib/` 不存在而失败，这是有意的。CI 的顺序同样是先 build 再 test。

**lint 必须用本目录的 `.oxlintrc.json`**：插件目录嵌在 dsh 检出里时，oxlint 会往上找到
dsh 根的配置（`correctness: off`，还忽略 `**/*.config.ts`），本地会报「0 warning」而
CI（独立检出、只有本目录的配置）报出真问题。所以配置写死在本目录，两边一致；
`correctness` 设为 `error`，warning 不留着过夜。

lint 是 type-aware 的（配置里 `typeAware: true`），所以 `oxlint-tsgolint` 也在
`devDependencies` 里：这是 oxlint 的类型检查后端，装在别处解析不到，CI 会直接报
「Failed to find tsgolint executable」。它的版本号和 oxlint 分开走，升级时一起看。

315 个用例，覆盖 `src/**` 全部文件（不是「被 import 到的文件」）。语句、函数、行都是
**100%**，分支 96.39%——剩下十几个走不到的分支：`??` 兜底、`String(error)` 兜底、
`req.url ?? '/'` 这类防御性写法，以及下面「已知限制」里那条没测的集合分支。

### 为什么 devDependencies 里有一堆和本插件无关的包

`@deepseek-ai/dsh-client-*` 发布出来的包**没有声明自己的第三方依赖**——在浏览器里它们由
shell 的模块表提供，所以包清单里是空的。而仓库外跑组件测试时，`FontFamilyRow.spec.tsx`
经由 primitives 这个 barrel 会连带 import 进 `shiki`、`katex`、十几个 `micromark-*` 和
`zustand`、`immer`、`react-dom`。

所以这几组包是**测试运行环境**的依赖，不是插件的依赖，版本与 dsh 仓库里
`packages/client/ui-primitives` 的 devDependencies 对齐：

- `@testing-library/react`、`@testing-library/dom`、`react-dom`、`@types/react-dom`
- `zustand`、`immer`（`dsh-client-store` 用）
- `shiki`、`@shikijs/langs`、`anser`、`diff`、`katex`、`micromark-*`、`mdast-util-*`（primitives 用）

`vitest.config.ts` 里把 primitives 设成 inline，是因为它 import 自己的 `.module.css`；
vitest 默认把 node_modules 外部化，这个 import 会落到 Node 的 ESM loader 上，而它不接受
`.css` 扩展名。

dsh 升级 primitives 的依赖时这里会缺包，报错是「Failed to resolve import ...」——照上面
那张清单补上、并保持与 dsh 仓库同版本即可。

想手动验证「直接丢文件进去也能识别」这条路径，把随仓库带的测试字体拷过去就行：

```sh
mkdir -p "$DSH_HOME/fonts" && cp tests/fixtures/Silkscreen-Regular.ttf "$DSH_HOME/fonts/"
```

Silkscreen（OFL 授权，32 KB）是一个像素字体，所以它有没有真正生效一眼就能看出来——
`tests/fixtures/OFL.txt` 是它的许可证正文，跟着一起走。

| 产物 | 内容 |
|---|---|
| `lib/index.js` + `lib/index.d.ts` | Host 半边（Node） |
| `lib/client/index.d.ts` | 浏览器半边的类型 |
| `lib/client.js` | **浏览器半边构件**，客户端模块系统真正加载的文件 |

改了任何浏览器侧代码都必须重新 `pnpm run build`：模块系统服务的是 `lib/client.js`，
不是源码。

## 存储实现

文件名由 Host 生成（`<族名 slug>-<8 位随机><扩展名>`），**不用客户端传来的名字**。
扩展名从文件 **magic bytes** 判断，不信任上传时的文件名。写入走 `<目标名>.staging`
再 `rename`，所以中途失败不会留下半个文件。

目录里读不出字体族的文件会被**静默跳过**（一条汇总 warning），不会让整个目录读失败。
设置页上传时则会**明确拒绝**非字体文件并说明原因。

## 它是怎么工作的

一个 dsh 客户端插件 = 同一个包里的两个半边，靠 `package.json` 连接：

| 半边 | 文件 | 跑在哪 | 职责 |
|---|---|---|---|
| Host | `src/index.ts` | Node | 装设置分节、注册 HTTP 路由、扫描字体目录、注入首屏脚本 |
| Browser | `src/client/index.ts`、`FontFamilyRow.tsx` | 浏览器 | 注册字典、注册设置行、把选择投影到 CSS 变量 |

发现链路：Loader 条目 → 沿模块路径向上找到最近的 `package.json` → 读 `dsh.client`
与 `exports["./client"]` → 把 `lib/client.js` 作为一行送进页面 → 浏览器执行它，
它调用 `window.__ModuleLoader__.load({ id, factory })` 注册工厂。

### HTTP 路由

前缀 `/api/ui-font-family`。写操作对所有人开放（这是有意的：本插件假设你已经用
dsh 自己的 token / 反向代理把整个界面保护起来了）。

| 路由 | 作用 |
|---|---|
| `GET /api/ui-font-family/catalog` | 返回字体目录、已安装字体、已上传字体 |
| `POST /api/ui-font-family/fonts` | 上传一个字体文件（body 就是字节） |
| `GET /api/ui-font-family/fonts/<id>` | 取回字体字节，`@font-face` 的 `src` 指向它 |
| `DELETE /api/ui-font-family/fonts/<id>` | 删除一个已上传字体 |

**已安装字体只发给同一台机器上的请求**：`req.socket.remoteAddress` 落在 loopback
或本机网卡地址里才返回族名列表，其他来源一律得到 `system: null`。这是一条安全不变式，
不是可配置项——局域网里的浏览器不应该拿到这台机器的字体清单。

### 上传字体怎么变成可用的字形

字体栈里写一个族名，只是让浏览器「想要」这个字体；真要有字形，必须有 `@font-face`
把族名指到一个 URL 上。这段声明由两边共同维护，都走同一个 `fontFaceCss()`，所以不会
出现两边指向不同 URL 的情况：

- **Host** 在 index 注入一行 `<style>`（`kind: 'style'`），内容就是当前已上传字体的全部
  `@font-face`。它的 id 是固定的 `dsh-ui-font-family-face`。
- **浏览器半边**读到 catalog 之后**接管同一个元素**（按 id 找，而不是再插一段），因为只
  有它知道这一次会话里新上传的字体；插件卸载时也由它把这个元素摘掉。

`font-display: swap`：字体文件没到之前先用后备字形显示，不让设置页把自己的标题藏起来。

族名来自字体文件的 name 表，也就是**文件可控的内容**；它会进到样式表里，所以
`readFontFamilies()` 在解析时就把 `{ } ; < >` 和控制字符换成空格（`sanitizeFamilyName()`），
否则一个精心构造的字体文件能关掉当前声明、往页面里塞自己的 CSS 规则。

### 字体栈是「扩展」而不是「替换」

这条规则是插件的核心，也是唯一能保证界面不乱的前提。

harness 自己在 ui-theme 的 `base.css` 里声明了 `--dsw-font-family`，并且整套排版 token
（`--dsw-font-*`、`--dsw-font-markdown-*`）都是把这条变量嵌进 `font:` 简写里的。也就是说：
**这条变量就是「界面用哪个字体」的唯一真源，harness 的间距和行高都是照它量的。**

所以本插件只做一件事——把用户选的族名**加在它前面**：

```
用户选的族名, <harness 自己那条栈，原封不动>
```

由此得到两个必须成立的性质：

- **「默认」预设什么都不装。** 用户选「默认」的意思就是「用 harness 的字体」，而唯一的
  实现方式是不写这条变量。任何写进这里的栈都只能是*另一个*字体栈，也就必然把界面的
  字体换掉。
- **别的选择都保留 harness 的尾巴。** 选中的族名画不出来的字符（中文、emoji、符号、
  这台机器上没有的族名）全部落回 harness 原本会用的字体，和没装插件时一模一样。

harness 那条栈是**从文档里读出来的**，不是抄在这个仓库里的：它写在主题样式表里，
抄一份就等于把插件钉死在某个 dsh 版本上，而且会悄悄改掉 harness 量过的字形顺序。

### 只改值，不抢写入权

字体最终落到页面上，走的是 harness 自己的那条路，插件不另起一套：

| 环节 | 谁做的 |
|---|---|
| 「用户选了什么字体」存在哪、怎么校验 | `SettingsProvider` + 本插件的 `ui-font-family` 分节 |
| 这个值怎么变成 CSS 变量 | `ctx.theme.overrideTokens()` —— ui-theme 公开的 token 覆盖层接口 |
| 谁把这个变量写到 DOM 上 | ui-layout 的 `ThemePresenter`（写到 `body` 的内联变量） |
| 这个变量被谁消费 | ui-theme 的 `--dsw-font-*` / `--dsw-font-markdown-*`，以及 `base.css` 的 `body` 规则 |
| 首屏那一段 | `webserver/index-inject` 的一行 body 脚本，和 ui-theme 自己的 `boot-theme.ts` 同一个写法 |

插件自己**不碰 DOM**。`overrideTokens` 的语义正好是这里需要的：一个 source 一层，
再次调用是**替换**而不是叠加，disposer 精确收回这一层——所以「装一次」和「重装一次」
不可能长出两条尾巴，卸载时也不会留下别的插件的东西。

唯一一处直接写 DOM，是收回**首屏那段脚本自己写下的那一行**：它跑在 theme 服务存在之前，
服务没见过它，也就不会替它收回。`ThemePresenter` 的原则是「只回收自己写的东西」，
这里照同一条原则办。

#### 踩过的坑：为什么族名顺序不能反

预设列表一律**先拉丁、后中文**，和 harness 自己的栈同序。

反过来写（中文族名在前）看起来更「照顾中文」，实际会把整个界面换掉：macOS 上
`PingFang SC` 一定存在，它排在前面就会连拉丁字母一起接管，而它的拉丁字形比
San Francisco 高——同样 14px，内联盒一个是 20px、一个是 17px。每个图标和标签的对齐、
每一处由文字撑开的盒子都跟着变，表现出来就是「整个页面图标和文字都错位了」。

同理，预设列表里**不能出现 `serif` / `monospace` 这类通用族名**：通用族名会就地解析成
已安装字体，浏览器会忽略它后面写的所有族名，那条 harness 的尾巴就会被整条丢掉。

### 首屏不跳字（FOUC）

Host 监听 `webserver/index-inject`，在 index 渲染时把选中的族名交给一段 body 脚本。脚本
写到 `document.body` 上——和 `ThemePresenter` 同一个元素、同一个属性，所以浏览器半边
接管时是「用同样的方式写同样的东西」，而不是去拆一个别人写的值。这段脚本和 ui-theme 的
`boot-theme.ts` 是同一个形状（它也是把 `--dsh-content-font-size` 写在同一处）。

脚本先摘掉自己写的内联样式、再读到主题声明的栈，然后写下 `<族名>, <harness 栈>`。
**先摘后读**是关键：直接读会读到自己上一轮写的值，每渲染一次就多接一条尾巴。浏览器半边
启动后做同一件事，随后把值交给 theme 服务。

「默认」预设不注入这一行；主题样式表那条 `:root` 声明本来就在，不需要谁来复述。

预设和已安装字体在首帧就是完全正确的。**上传字体做不到完全没有跳变**：族名和
`@font-face` 在第一帧都已经就位，但字体文件本身要异步加载，中间那一小段会用后备字形。

### 闭环不变式

这些是测试真正在守的东西：

1. `resolveFontProjection` 是全函数，任何输入都不抛异常。
2. 装出去的每一条栈都以 **harness 自己那条栈**收尾，所以中文永远不会掉出字体栈。
3. Host 首屏和浏览器半边调**同一个** resolver 和同一个 `composeFontStack()`。
4. 浏览器半边从 DOM 读回首屏写入的值，而不是自己重新算一遍。
5. 降级在界面上看得见：选中的字体解析不出来时，那一行会明说，而不是安静地显示别的字体。
6. 卸载插件只回收它自己写的那条内联样式。
7. 字体扫描失败、catalog 拉不到，都不影响预设和上传。
8. `@font-face` 只有 `fontFaceCss()` 一个生成口，Host 首屏和浏览器半边不可能写出两份
   指向不同 URL 的声明；族名在解析处就清洗过，进不了样式表语法。
9. 页面上那个值只有一个写入者：插件只调 `ctx.theme.overrideTokens()`，DOM 由 ui-layout
   的 `ThemePresenter` 写；插件直接碰 DOM 的唯一一处，是收回它自己首屏写下的那一行。

一次选择写 `source` 和 `id` **两个字段**，用一次 `mutate([...])` 提交。分两次写会先拿旧的
`id` 去校验新的 `source`，而系统字体族名不是预设 id，合法的切换会在中途被拒。

## 目录

```
src/
├── index.ts              Host 半边：解析 config、装设置分节、注册路由、注入首屏脚本
├── font-settings.ts      命名空间、两个字段、schema、跨字段校验
├── font-presets.ts       内置预设各自点名的族（不带尾巴）
├── font-selection.ts     选择 → 族名列表 → 前置到 harness 栈（Host 与浏览器共用）
├── font-formats.ts       认得的扩展名（浏览器 accept 列表用，不依赖 fontkit）
├── font-files.ts         magic bytes → 扩展名，fontkit → 字体族名（含族名清洗）
├── font-face.ts          已上传字体的 @font-face 声明（Host 与浏览器共用）
├── user-fonts.ts         上传目录：列出 / 读 / 写 / 删
├── system-fonts.ts       平台字体目录扫描与缓存
├── font-routes.ts        HTTP 路由与同机访问判定
├── boot-font.ts          首屏注入那一行
└── client/
    ├── index.ts          插件体：绑 scope、注册字典、注册设置行
    ├── font-runtime.ts   状态机：选谁、写什么、界面上是什么
    ├── font-catalog.ts   往 Host 那四个路由发请求
    ├── font-presenter.ts 决定 token 层的值；写入交给 ctx.theme
    ├── font-face-style.ts 接管 / 更新 / 摘掉 @font-face 那段 <style>
    ├── settings-store.ts 渲染用的快照 store
    ├── FontFamilyRow.tsx 设置行
    ├── FontPickerDialog.tsx   选字体（搜索 + 分组 + 每行自预览）
    ├── FontManagerDialog.tsx  上传 / 删除
    └── locales.ts        中英文字典
tests/                    vitest，18 个 spec
├── package-files.spec.ts 打包用例：files 是否覆盖入口 import 到的每个模块
└── client/index.spec.ts  插件体：注册了什么、注入的动作接到哪里、卸载时收回什么
assets/                   README 用的截图
.github/workflows/ci.yml     分支与 PR 的门禁
.github/workflows/release.yml tag → 门禁 → tgz → GitHub Release
.github/dependabot.yml       月度依赖与 action 更新（分组）
cordis.patch.yml          bundle 覆盖层（装进 profile 时用，行的 name 是包名）
cordis.yaml               --patch 覆盖层（开发用，行的 name 是 ./src/index.ts）
tsdown.config.ts          复现惰性 CJS 工厂格式的打包配置
vitest.config.ts          jsdom/node 环境、覆盖率门禁、primitives 内联
.oxlintrc.json            lint 规则（本目录自带，不继承 dsh 检出的配置）
pnpm-workspace.yaml       本包自己的 workspace 根（不往上找别人的）+ 构建脚本放行
pnpm-lock.yaml            CI 跑 --frozen-lockfile，必须提交
```

## 必须遵守的约定

- **`lib/client.js` 只能是「惰性 CJS 工厂」**：执行时只注册工厂，业务代码延迟到首次
  require。官方共享预设 `clientBundle()` 用不了（它要求包在 dsh 仓库的 `packages/*/*`
  下），所以 `tsdown.config.ts` 自己复现了同样的产物格式。**不要改 banner / footer /
  intro 三行。**
- **只能 require 模块表里有的 specifier**。基线见 `tsdown.config.ts` 的 `PLATFORM_MODULES`；
  其余依赖会被内联进 bundle。这些名字**不要**写进 `dependencies`（`clsx` 就是被内联的）。
- **`settings.general.item` 是别人声明的插槽**，名字由 General 分节的 owner 固定，必须
  一字不差；`kind: 'list'` 意味着要自己取不重复的 `id`（本插件用 `font-family`）和
  `order`（本插件用 `11.5`，插在 ui-theme 的 font-size `11` 和 ui-chat 的
  transcript-view `12` 之间——这两个整数都被占了，所以只能取半步）。
- **产品文案一律走 locale 字典**（`src/client/locales.ts`），组件里不出现中英文字面量。
- **样式只用 `--dsw-*` 设计令牌**，CSS Modules，不写字面色值，不写死字号 / 间距。
- **注册即副作用，一律包在 `ctx.effect` / `ctx.slots.inject` 里**，插件卸载时自动回收。
- **部署相关取值一律走 `config`**，代码里不留可调常量。
- **改 harness 的渲染，只能用 harness 自己提供的入口**。字体这件事上就是
  `ctx.theme.overrideTokens()`：插件只交出「这个变量该是什么值」，写入、回收、层叠顺序
  都归 ui-theme / ui-layout 管。不要在插件里另写一份 presenter——那会同时存在两个写入者，
  卸载时谁也收不干净。首屏那段脚本是唯一的例外，写法照抄 `ui-theme/src/boot-theme.ts`。
- **`theme` 是必须注入的服务**（`src/client/index.ts` 的 `inject`），并且
  `dsh.client.inject` 里要跟着写上 `@deepseek-ai/dsh-client-ui-theme`（那个字段是给人看的
  依赖说明，不排激活顺序）。

## 已知限制

- **只影响界面正文**。代码块用的 `--ds-font-family-code` 是有意不动的：等宽字体换成
  非等宽字体会把代码排版弄坏。
- **上传字体首帧有极短的跳变**，原因见上面的 FOUC 一节。
- **预设列表里没有 `serif` / `monospace` 这类通用族名**，所以「等宽」在七个具名等宽族
  全都不存在的机器上会落到 harness 的正文字体，而不是浏览器的通用等宽字体。这是为了
  保住 harness 的尾巴必须付的代价：通用族名后面写的族名会被浏览器整条忽略。
- **预告片用中文名渲染时看不出差别**。选字体对话框里每行用自己的字体画自己的名字，而内置
  预设的名字是中文（无衬线 / 衬线 / 等宽），中文落到的是 harness 的中文字体，所以三行的
  差别没有拉丁字母那么明显。系统字体和上传字体（名字通常来自字体文件本身）能看到区别。
- **字体自己的纵向度量会决定基线落在哪儿，插件不改它。** harness 的排版 token 把行高写死
  了（14px 正文配 22px 行高），基线在行盒里的位置由字体自己的 ascent/descent 算：
  `半行距 = (行高 − (ascent + descent)) / 2`，`基线 = 半行距 + ascent`。所以 descent 大的
  字体基线会被顶上去。同一台机器上实测（14px / 22px 行盒，16px 图标居中）：

  | 字体 | ascent | descent | 基线位置 | 图标中心 − 基线 |
  |---|---|---|---|---|
  | harness 自己的栈 | 14 | 3 | 16px | −5px |
  | Georgia | 13 | 3 | 16px | −5px |
  | Helvetica Neue | 13 | 3 | 16px | −5px |
  | Al Nile | 12 | 7 | 13px | −2px |
  | Al Bayan | 14 | 7 | 14px | −3px |

  阿拉伯字体在基线下面要留出变音符号的位置，descent 天生就大，于是文字在行盒里偏高、
  图标不动，看起来就是「字高图标低」。这不是插件引入的：浏览器是照**第一个可用字体**的
  表算行盒的，DSH 的样式表里没有任何 `ascent-override` / `size-adjust`，任何允许选字体的
  界面都会有同样的表现。要抹平它就得替用户重写字体度量（`@font-face` 的
  `ascent-override` 只对上传字体可用），那是另做一个 DSH 没有的策略，本插件不做。
  选任何 descent 为 3 左右的字体（San Francisco / PingFang / Georgia / Helvetica / Arial /
  Times 等）都不会有这个问题。
- **字体清单是每页加载时的一份快照**。在另一个浏览器里删掉某个字体，当前页面不会自己
  发现，要刷新。上传 / 删除之后本页面会重新拉一次。
- **同名族会并列出现**。两个文件声明同一个族名（比如手动拷进去一份、又上传了一份）时，
  列表里就是两行同名项；它们确实是两个文件，删掉其中一个另一个仍在。
- **`system` 选择不做清单校验**。字体装在哪台机器、哪台机器在跑浏览器，插件无从判断，
  所以只能照写，由浏览器自己兜底到字体栈里的后备字体。
- **写入路由没有鉴权**，见上面的 HTTP 路由一节。
- **字体集合（`.ttc` / `.otc`）只会被识别，没有被解析过**。识别格式靠魔数，这一步有测试；
  但「一个集合里读多个族名」那条分支没有测试——仓库里放不下一份 OFL 授权的 `.ttc`，
  手搓一份偏移表又只是在测自己写的构造器。真要用集合字体的话，这里是第一个该补的地方。
- **浏览器半边的接线（slot 注册那一层）没有自动化测试**。dsh 仓库内的插件用
  `vite-tsconfig-paths` 把 `@deepseek-ai/dsh-client-*/client` 映射到源码来跑这类 bench，
  而仓库外只能解析到 `lib/client.js`——那是给 shell 模块表用的惰性工厂，直接 import 会
  炸。所以这一层靠真机验证：`pnpm dsh web --patch ... --port 3082`，看设置页里那一行的
  位置和交互。剩下的逻辑（resolver、catalog、store、presenter、对话框）都有单测。

## CI 与发布

### 什么时候跑什么

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `ci.yml` | push 到 `main`、指向 `main` 的 PR、手动 `workflow_dispatch` | Node `22.x` / `24.x` 两条腿：`install --frozen-lockfile` → typecheck → lint → build → `test:coverage`；另有一个 `package` 作业打 tgz 并作为构建产物上传 |
| `release.yml` | push `v*` tag | 先跑同一套门禁，再校验 tag 与 `package.json` 版本一致、tgz 里确有 `lib/index.js` / `lib/client.js` / `cordis.patch.yml`，最后把 tgz 挂到 GitHub Release 上 |

**为什么 CI 不管 tag**：tag 由 `release.yml` 负责，而它自己会把同一套门禁再跑一遍，
所以「分支绿」不会顺带把 tag 也放行——发布的依据只有那一次发布运行本身。

**为什么 CI 不用 `pull_request_target`**：它会把仓库写权限交给 fork 的代码。这里只需要
读权限，`pull_request` 就够。

**为什么先 build 再 test**：见上面「构建与测试」，打包用例读 `lib/`。

`push` 到 `main` 也会跑一遍，因为合并进来的东西（尤其是别人 PR 的 merge commit）
值得在主干上再验一次；`concurrency` 按 ref 分组并取消旧运行，连推多次只留最后一次。

### 发一个版本

版本号还在 `0.x`：`0.x` 的小版本可以有破坏性改动，`1.0` 之前不承诺兼容。

```sh
# 1. 改版本号（不提交 tag）
npm version 0.3.1 --no-git-tag-version
# 2. 提交并推送
git commit -am "Release 0.3.1" && git push origin main
# 3. 打 tag 触发 release.yml
git tag v0.3.1 && git push origin v0.3.1
```

tag 必须写成 `v<版本号>`（`release.yml` 会校验），tgz 会以
`dsh-plugin-ui-font-family-0.3.1.tgz` 的名字挂到 Release 上——README 里那条 tgz 安装命令
用的就是这个文件名，所以**改完版本号要顺手把 README 里的版本号也改掉**。

`release.yml` 是幂等的：重跑一次会 `--clobber` 覆盖已上传的附件，不会因为 Release 已存在而失败。

### 发到 npm

这一步目前是**手动**的：账号开了通行密钥（`auth-and-writes`），发布要在浏览器里过一次验证，
脚本代替不了。

```sh
cd dsh-plugin-ui-font-family
npm publish     # 先跑 prepare 构建 lib/，再上传；浏览器里过一下验证
```

公开范围由清单里的 `publishConfig.access: "public"` 决定，命令行上不用再写 `--access public`。
发完确认两件事：

```sh
npm view dsh-plugin-ui-font-family version                # 期望与 tag 一致
dsh plugin --profile web add dsh-plugin-ui-font-family    # 不需要 allowBuilds
```

**顺序**：先推 tag 让 `release.yml` 出 Release，再发 npm，两边版本号必须一致。npm 上的版本一旦
发出去就不能重发（72 小时内可以撤回，之后不行），所以发之前先 `npm publish --dry-run` 看一眼
文件清单和体积。

要把这一步也交给 CI，需要先在 npmjs.com 上给这个包配好 trusted publisher（GitHub Actions +
本仓库的 workflow 文件名），再给 workflow 加 `permissions: id-token: write` 并让它跑
`npm publish`——那样就不再需要任何长期 token。首次发布仍然要手动或用一次性 token 引导。

## 发布前

发到 GitHub 当插件仓库时，用户侧只需要 `dsh plugin add <地址>`；下面这些是本仓库自己要做完的事。

- `package.json` 是公开可发布的（无 `private`，`publishConfig.access: "public"`），包名无 scope。
  要改成 scoped 名（`@your-name/...`）只需要改 `name`：`tsdown.config.ts` 里的模块 id 是从
  `package.json` 读的，不用跟着改；但 README 里的安装命令和 `dsh` 清单里的引用名要一起改。
- 发布前先 `npm pack --dry-run` 看一遍文件清单，或者直接 `pnpm test` —— `tests/package-files.spec.ts`
  已经把「`files` 是否漏掉入口 import 的兄弟模块」变成了一条会失败的用例。
- `@deepseek-ai/*` 一律进 `peerDependencies`（+ `devDependencies`），不要进 `dependencies`：
  插件跑在 dsh 进程里，必须拿到宿主**那一份**实例（profile 的 module fallback，
  `$DSH_HOME/profiles/node_modules`），从 registry 另装一份会让 Service、Schema 和 brand
  符号对不上。版本跟着宿主走，别自己钉死。
- 别人装的时候 pnpm 会报 `missing peer @deepseek-ai/...` 警告，这是预期的：
  profile 的 `pnpm-workspace.yaml` 设了 `autoInstallPeers: false`，这些 peer 不由 pnpm 装。
- 重新核对 `PLATFORM_MODULES` 与目标 dsh 版本的基线是否一致
  （来源：`packages/client/web/src/platform.ts`）。
- `tests/fixtures/` 下的 Silkscreen 是 OFL 授权字体，`OFL.txt` 必须跟着一起走。
- 想让人 `add github:rhczz/仓库` 直接装的话，`prepare`（`tsc && tsdown`）会在**装插件那一刻**
  在用户机器上执行 —— 用 `npm install` 装一遍 `dependencies` + `devDependencies` + `peerDependencies`
  再构建，几十秒起步。pnpm 默认拦这类脚本，用户要在 profile 的 `pnpm-workspace.yaml` 里加
  `allowBuilds`（`dsh plugin` 失败时会把该写的 key 原样打出来）。不想让用户碰这一步，
  就发 npm（`dsh plugin add dsh-plugin-ui-font-family` 装的是预构建产物），或者发一个 tag，
  让 `release.yml` 把 tgz 挂到 Release 上 —— 这两条路都不跑任何安装期脚本。
- `pnpm-lock.yaml` 必须提交：CI 和 release 都跑 `--frozen-lockfile`。
