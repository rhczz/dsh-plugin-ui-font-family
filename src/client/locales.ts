/**
 * The locale namespace this plugin owns. `zh` is the single source of the key
 * set and `en` is constrained to it, so a missing or extra translation fails
 * the build instead of reaching a user.
 * @module dsh-plugin-ui-font-family/client/locales
 */

/** Namespace this plugin registers its copy under. */
export const FONT_LOCALE_NAMESPACE = 'ui-font-family'

/** Simplified-Chinese dictionary; also the source of the key set. */
export const zh = {
  'fontFamily.title': '字体',
  'fontFamily.description': '设置界面与正文使用的字体',
  'fontFamily.trigger': '选择字体',
  'fontFamily.missing': '所选字体已不可用，暂用默认字体显示',
  'fontFamily.unknownName': '未知字体',

  'group.presets': '预设',
  'group.uploaded': '我的字体',
  'group.system': '系统字体',

  'preset.default': '默认',
  'preset.sans': '无衬线',
  'preset.serif': '衬线',
  'preset.mono': '等宽',

  'action.manage': '上传与管理字体…',
  'action.reset': '恢复默认',
  'action.retry': '重新读取',
  'action.remove': '删除',
  'action.close': '关闭',

  'search.placeholder': '搜索字体',
  'search.empty': '没有匹配的字体，可在下方上传字体文件',
  'search.truncated': '结果过多，仅显示前一部分，输入关键词可缩小范围',

  'system.unread': '正在读取本机字体…',
  'system.remote': '当前不是从本机访问，无法列出服务器上的字体',
  'system.disabled': '该部署已关闭系统字体扫描',
  'system.empty': '没有找到可用的系统字体',
  'system.more': '输入关键词可搜索全部 {count} 个字体',
  'uploaded.empty': '还没有上传字体',

  'notice.uploaded': '字体已上传并启用',
  'notice.removed': '字体已删除',
  'notice.reset': '已恢复默认字体',
  'notice.loadFailed': '字体列表读取失败',
  'notice.uploadFailed': '上传失败',
  'notice.removeFailed': '删除失败',
  'notice.settingsFailed': '设置保存失败',
  'notice.tooLarge': '文件超出大小上限',

  'picker.title': '选择字体',
  'picker.description': '每一行都用它自己的字体显示，选中后立即生效',

  'manager.title': '字体管理',
  'manager.description': '上传的字体保存在以下目录，把字体文件直接复制进去同样会被识别：',
  'manager.drop': '把字体文件拖到这里',
  'manager.or': '或',
  'manager.browse': '选择文件',
  'manager.hint': '支持 .ttf .otf .woff .woff2 .ttc，需为可解析的字体文件',
  'manager.uploading': '正在上传…',
  'manager.listTitle': '已上传的字体',
  'manager.close': '关闭',

  'confirm.title': '删除字体',
  'confirm.description': '删除后无法恢复。该字体正在被使用时，字体会回到默认设置。',
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

/** English dictionary; the record type keeps it level with {@link zh}. */
export const en: Record<FontKey, string> = {
  'fontFamily.title': 'Font',
  'fontFamily.description': 'Font used by the interface and message text',
  'fontFamily.trigger': 'Choose a font',
  'fontFamily.missing': 'The chosen font is unavailable; the default is used instead',
  'fontFamily.unknownName': 'Unknown font',

  'group.presets': 'Presets',
  'group.uploaded': 'My fonts',
  'group.system': 'System fonts',

  'preset.default': 'Default',
  'preset.sans': 'Sans serif',
  'preset.serif': 'Serif',
  'preset.mono': 'Monospace',

  'action.manage': 'Upload and manage fonts…',
  'action.reset': 'Restore default',
  'action.retry': 'Read again',
  'action.remove': 'Delete',
  'action.close': 'Close',

  'search.placeholder': 'Search fonts',
  'search.empty': 'No font matches. Upload a font file below to add one.',
  'search.truncated': 'Too many results; only the first part is listed, type to narrow it down',

  'system.unread': 'Reading the fonts installed on the host…',
  'system.remote': 'This page is not open on the host machine, so its fonts cannot be listed',
  'system.disabled': 'This deployment turned system font scanning off',
  'system.empty': 'No usable system font was found',
  'system.more': 'Type to search all {count} installed fonts',
  'uploaded.empty': 'No font has been uploaded yet',

  'notice.uploaded': 'Font uploaded and selected',
  'notice.removed': 'Font deleted',
  'notice.reset': 'Default font restored',
  'notice.loadFailed': 'Could not read the font list',
  'notice.uploadFailed': 'Upload failed',
  'notice.removeFailed': 'Delete failed',
  'notice.settingsFailed': 'Could not save the setting',
  'notice.tooLarge': 'The file is larger than the accepted limit',

  'picker.title': 'Choose a font',
  'picker.description': 'Each row is drawn in the font it names; choosing one applies it immediately',

  'manager.title': 'Manage fonts',
  'manager.description': 'Uploaded fonts are kept in this directory; copying a font file into it works too:',
  'manager.drop': 'Drop a font file here',
  'manager.or': 'or',
  'manager.browse': 'Choose a file',
  'manager.hint': 'Accepts .ttf .otf .woff .woff2 .ttc, and the file must parse as a font',
  'manager.uploading': 'Uploading…',
  'manager.listTitle': 'Uploaded fonts',
  'manager.close': 'Close',

  'confirm.title': 'Delete font',
  'confirm.description': 'This cannot be undone. If the font is in use, the default is restored.',
  'confirm.cancel': 'Cancel',
  'confirm.confirm': 'Delete',
}
