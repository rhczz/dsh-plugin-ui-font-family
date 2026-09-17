/**
 * The locale namespace this plugin owns. `zh` is the key-set source of truth and
 * `en` is checked against it, so a missing or extra translation fails the build.
 * @module dsh-plugin-ui-font-family/client/locales
 */

/** Namespace this plugin registers its copy under. */
export const FONT_LOCALE_NAMESPACE = 'ui-font-family'

/** Simplified-Chinese dictionary; also the source of the key set. */
export const zh = {
  'fontFamily.title': '字体',
  'fontFamily.description': '界面与正文使用的字体',
  'fontFamily.trigger': '选择字体',
  'fontFamily.missing': '所选字体不可用，已回退到默认字体',
  'fontFamily.unknownName': '未知字体',

  'group.presets': '预设',
  'group.uploaded': '已上传',
  'group.system': '系统字体',

  'preset.default': '默认',
  'preset.sans': '无衬线',
  'preset.serif': '衬线',
  'preset.mono': '等宽',

  'action.manage': '上传与管理字体…',
  'action.reset': '恢复默认',
  'action.retry': '重新读取',
  'action.rescan': '重新扫描系统字体',
  'action.remove': '删除',
  'action.close': '关闭',

  'search.placeholder': '搜索字体',
  'search.empty': '没有匹配的字体',
  'search.truncated': '结果过多，仅显示前一部分；可用搜索缩小范围',

  'system.unread': '正在读取系统字体…',
  'system.remote': '当前页面不在运行 dsh 的机器上，无法列出该机器的字体',
  'system.disabled': '此部署已关闭系统字体扫描',
  'system.empty': '未找到可用的系统字体',
  'system.more': '输入关键词可搜索全部 {count} 个系统字体',
  'uploaded.empty': '尚未上传字体',

  'notice.uploaded': '字体已上传并启用',
  'notice.removed': '字体已删除',
  'notice.reset': '已恢复默认字体',
  'notice.loadFailed': '字体列表读取失败',
  'notice.uploadFailed': '上传失败',
  'notice.removeFailed': '删除失败',
  'notice.settingsFailed': '设置保存失败',
  'notice.tooLarge': '文件超出大小上限',

  'picker.title': '选择字体',
  'picker.description': '每行以自身字体预览，选中后立即生效',

  'manager.title': '字体管理',
  'manager.description': '上传的字体保存在以下目录；直接复制字体文件进去也会被识别：',
  'manager.descriptionRemote': '上传的字体保存在运行 dsh 的机器上，目录路径只在该机器上显示。',
  'manager.drop': '将字体文件拖到这里',
  'manager.or': '或',
  'manager.browse': '选择文件',
  'manager.hint': '支持 .ttf .otf .woff .woff2 .ttc，文件需可解析为字体',
  'manager.uploading': '正在上传…',
  'manager.listTitle': '已上传的字体',
  'manager.close': '关闭',

  'confirm.title': '删除字体',
  'confirm.description': '删除后无法恢复；若该字体正在使用，界面将回到默认字体',
  'confirm.cancel': '取消',
  'confirm.confirm': '删除',
}

/** Every copy key of this namespace. */
export type FontKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Font settings row and its management dialog. */
    [FONT_LOCALE_NAMESPACE]: FontKey
  }
}

/** English dictionary, checked complete against the `zh` key set. */
export const en = {
  'fontFamily.title': 'Font',
  'fontFamily.description': 'Font for the interface and conversation text',
  'fontFamily.trigger': 'Choose a font',
  'fontFamily.missing': 'The chosen font is unavailable; the interface uses the default',
  'fontFamily.unknownName': 'Unknown font',

  'group.presets': 'Presets',
  'group.uploaded': 'Uploaded',
  'group.system': 'System fonts',

  'preset.default': 'Default',
  'preset.sans': 'Sans serif',
  'preset.serif': 'Serif',
  'preset.mono': 'Monospace',

  'action.manage': 'Upload and manage fonts…',
  'action.reset': 'Restore default',
  'action.retry': 'Read again',
  'action.rescan': 'Rescan installed fonts',
  'action.remove': 'Delete',
  'action.close': 'Close',

  'search.placeholder': 'Search fonts',
  'search.empty': 'No matching font',
  'search.truncated': 'Too many results; only the first are listed — search to narrow them',

  'system.unread': 'Reading system fonts…',
  'system.remote': "This page is not open on the machine running dsh, so that machine's fonts cannot be listed",
  'system.disabled': 'This deployment turned system font scanning off',
  'system.empty': 'No usable system font was found',
  'system.more': 'Type to search all {count} system fonts',
  'uploaded.empty': 'No font has been uploaded yet',

  'notice.uploaded': 'Font uploaded and selected',
  'notice.removed': 'Font deleted',
  'notice.reset': 'Default font restored',
  'notice.loadFailed': 'Could not read the font list',
  'notice.uploadFailed': 'Upload failed',
  'notice.removeFailed': 'Delete failed',
  'notice.settingsFailed': 'Could not save the setting',
  'notice.tooLarge': 'The file exceeds the size limit',

  'picker.title': 'Choose a font',
  'picker.description': 'Each row previews its own font; choosing one applies it immediately',

  'manager.title': 'Manage fonts',
  'manager.description': 'Uploaded fonts are stored in this directory; copying a font file into it also works:',
  'manager.descriptionRemote': 'Uploaded fonts are stored on the machine running dsh; the path is shown only there',
  'manager.drop': 'Drop a font file here',
  'manager.or': 'or',
  'manager.browse': 'Choose a file',
  'manager.hint': 'Accepts .ttf .otf .woff .woff2 .ttc; the file must parse as a font',
  'manager.uploading': 'Uploading…',
  'manager.listTitle': 'Uploaded fonts',
  'manager.close': 'Close',

  'confirm.title': 'Delete font',
  'confirm.description': 'This cannot be undone. If the font is in use, the interface returns to the default.',
  'confirm.cancel': 'Cancel',
  'confirm.confirm': 'Delete',
} satisfies Record<FontKey, string>
