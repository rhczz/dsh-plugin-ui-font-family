---
description: "在 dsh Web 界面「通用设置」中增加一行「字体」：四个内置预设、运行 dsh 的机器上已安装的字体，以及本部署提供给所有连接浏览器的字体文件。"
kind: "package-bundle"
---

# dsh-plugin-ui-font-family

[English](README.md) | 中文

## 概述

「通用设置」里的「字体」行决定界面与会话正文使用的字体。用户可选择四个内置预设、搜索运行 `dsh` 的机器上已安装的字体，或上传字体文件，上传的字体由本部署提供给所有连上来的浏览器。选择立即生效并持久保存。本包以 profile bundle 形式安装：`dsh plugin --profile web add dsh-plugin-ui-font-family` 加入该行，移除本包即移除该行。代码块仍使用 harness 自带的等宽字体栈。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

```text
dsh plugin --profile web add dsh-plugin-ui-font-family
dsh plugin --profile web remove dsh-plugin-ui-font-family
```

本包声明了 `dsh.bundle.patch`，因此 `add` 会把它记入 profile 的 `dsh.profile.bundles` 并应用其覆盖层，把 `ui-font-family` 一行插入配置树。重启 `dsh web` 后，该行出现在「设置 → 通用设置」，位于「字号大小」下方。

从 npm 安装使用已发布的产物；从 git ref 或源码目录安装会在本机构建一次。pnpm 默认拦截构建脚本，直到 profile 的 `pnpm-workspace.yaml` 放行：按首次尝试打印出的 `allowBuilds` 一行配置即可。

### 提供的内容

- **「字体」行**打开选择器：预设、已上传字体，以及运行 `dsh` 的机器上已安装的字体；带搜索框，每一行都用它自己的字体预览。
- **管理对话框**用于上传字体（`.ttf` `.otf` `.woff` `.woff2` `.ttc`，默认单个 20 MiB）、删除字体，并显示上传字体的存放目录。
- **安装的字体栈**把所选字体族排在 harness 自己声明的字体栈之前，所选字体画不出的字符回退到 harness 的字体。代码块仍使用等宽字体栈。

![「通用设置」里的字体行](assets/settings-font-row.png)

![字体选择器](assets/font-picker.png)

### 配置

全部字段可选，写在 profile 自己的 `$DSH_HOME/profiles/web/cordis.patch.yml`：

```yaml
- id: ui-font-family
  config:
    defaultFamily:
      source: preset
      id: serif
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `fontDir` | `$DSH_HOME/fonts` | 上传字体的存放目录。 |
| `dshHome` | `$DSH_HOME`，再退回 `~/.dsh` | 覆盖本包解析路径所用的 harness home。 |
| `systemFontDirs` | `[]` | 追加扫描的目录，排在平台默认目录之后。 |
| `scanSystemFonts` | `true` | 是否扫描平台默认目录；`systemFontDirs` 里写明的目录仍会扫描。 |
| `maxUploadBytes` | `20971520` | 单个上传的字节上限；页面在读取文件之前就拒绝超限的文件。 |
| `defaultFamily` | `{ source: preset, id: default }` | 用户选择之前使用的字体，「恢复默认」也回到它。 |

`defaultFamily.source` 取 `preset`、`system` 或 `upload`，`id` 分别是预设名、CSS 族名或已存储字体。用户自己的选择永远压在它上面。本包无法处理的取值——非整数的上限、本构建不提供的预设 id——在加载时报错，而不是等到使用时。

### 上传字体的存放位置

`$DSH_HOME/fonts`，默认即 `~/.dsh/fonts`，与 `settings.yaml` 同级。管理对话框会显示当前使用的路径。

- 备份、迁移或删除只需处理这一个目录；浏览器中不保存任何字体。
- 不经过设置页，直接把字体文件拷进该目录同样会被识别，删除同理。
- 存储文件名为 `<族名>-<16 位十六进制>.<扩展名>`；扩展名取自文件内容而非上传时的文件名。写入先落临时文件再改名。
- 浏览器使用的字体来自运行 `dsh` 的机器，因此本部署上所有连上来的浏览器都能使用。

### 卸载

```text
dsh plugin --profile web remove dsh-plugin-ui-font-family
```

该命令移除该行并停止提供字体。有两处内容会留下：

- **已上传的文件**位于 `$DSH_HOME/fonts`。删除该目录即可清除，也可以保留，日后重新安装本包继续使用。
- **保存的选择**位于 `$DSH_HOME/settings.yaml` 的 `ui-font-family` 下。没有本包时它不起作用，可以一并删除。

### Host 不在本机时

已安装字体清单描述的是运行 `dsh` 的机器，且只发给来自该机器的请求，因此别的机器上的浏览器看不到「系统字体」分组。远程用户仍可选择已上传的字体；部署方也可以把 `defaultFamily` 设为浏览器本机存在的 `system` 族名——Host 只校验该名字能否安全输出，不校验是否存在。

在 Host 所在机器上运行反向代理时，远程请求会以本机地址到达，从而被判定为同机。这类部署若要阻止下发已安装字体清单，设 `scanSystemFonts: false`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包分 Host 与浏览器两半，由 `package.json`（`dsh.client` 与 `./client` 导出）连接。Host 注册设置分节、扫描字体目录、应答 HTTP 路由并注入插件前的一行；浏览器渲染设置行，并把每次变更投影到文档。

| 路径 | 职责 |
|---|---|
| `src/index.ts` | Host 插件主体：配置解析、设置分节、索引注入行、路由注册。 |
| `src/font-routes.ts` | 目录、下载、上传、删除路由，以及同源与同机判定。 |
| `src/user-fonts.ts` | 上传目录：存储、列举与删除文件，带按文件标识的缓存。 |
| `src/system-fonts.ts` | 已安装字体索引：平台目录、有界并发扫描，以及同一套标识缓存。 |
| `src/font-selection.ts` | 把选择解析为字体族并排在 harness 字体栈之前；两半共用。 |
| `src/font-settings.ts`、`src/font-settings-schema.ts` | 设置命名空间、族名规则，以及 Host 注册的 schema。 |
| `src/boot-font.ts`、`src/font-face.ts` | 插件前的一行，以及写入所服务页面的 `@font-face` 块。 |
| `src/client/` | 设置行、选择器、管理对话框、运行时，以及安装字体栈的 theme token 层。 |

两个决定塑造了其余部分。引导行只为所选的那个已存储字体声明 `@font-face`：索引渲染不能等待文件读取，其余声明由浏览器半读取目录后补齐。族名来自字体文件与设置文档，因此每个名字在进入样式表或被服务的脚本之前都要过一道字符规则。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — bundle、profile，以及本包安装进的那套层序。
- [添加设置卡片](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.md) — 本行使用的设置分节与插槽注册。
- [Web 样式](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md) — 安装的字体栈所遵循的 token 与样式规则。
- [ui-theme](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-theme) — 本行上方的「字号大小」行，以及本行镜像的插件前引导。
- [许可证](LICENSE) — MIT。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制是本包当前的约束，说明字体改变不了什么、本部署不做什么。

- **只影响界面文字** — 代码块、diff 与终端输出仍使用 harness 的等宽字体栈；在此处装入比例字体会破坏对齐。
- **预设只写明它要改的字体** — harness 自己的字体栈始终留在每个已安装字体栈之后，因此所选字体覆盖不到的字符（例如预设没有中文字体时的中文）由 harness 的字体按自身度量绘制。
- **个别字体会改变文字高度** — 行盒高度来自字体的 ascent 与 descent，垂直度量异常大的字体会画出比 harness 预期更高的行。本插件只排列字体族，不重写度量，也无法修正度量不同的字体。
- **一个字体族只有一个字面** — 已存储字体自身的字重与字形变体不单独提供，粗体由该字面合成。
- **字体集合（`.ttc`）按内含字面报告多个字体族** — 选择其中任何一个都会下载整个集合文件。
- **上传只限制单文件大小，不限制总量** — `maxUploadBytes` 限制单个文件，目录总大小没有上限。
- **已安装字体清单只发给来自运行 `dsh` 的机器的请求** — 这是安全规则而非配置项，因此别处的浏览器即使能用这些字体也看不到「系统字体」分组。
- **Host 所在机器上的反向代理会使该规则失效** — 判定读取的是对端地址，本机代理就是本机对端。这样前置 `dsh` 的部署必须设 `scanSystemFonts: false`。
- **写入过程中崩溃可能留下一个 `.staging` 文件** — 所有读取都会忽略它，也永远不会被提供；碍事时手工删除即可。
- **延期事项** — 没有上传总量配额，字体集合不支持按字面选择，也无法枚举浏览器本机字体（浏览器平台不提供该能力）；上传字体与 `system` 默认值就是为这种部署形态准备的。

**运行时不变式：** 不发布运行时不变式伴生入口：每个记住的族名在复用前都会按文件标识重新校验，因此目录清单不会报告目录中已不存在的文件。
