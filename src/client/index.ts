/**
 * Browser half of the font family plugin. It binds the feature's settings
 * namespace, owns the runtime that projects the chosen font onto
 * `--dsw-font-family`, and registers the Font row in the General settings
 * section, between the Appearance and Font size rows.
 *
 * The settings namespace is registered by the Host half; this half consumes it,
 * so a deployment that loads the plugin before any browser connects still
 * resolves a font for the bootstrap row.
 * @module dsh-plugin-ui-font-family/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.theme Context merge (the token-override layer this
// plugin installs is written by the theme service, never by this plugin).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.settingsScope Context merge and the scope contract. The
// font half never imports another feature plugin's values.
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { FONT_SETTINGS_NAMESPACE, type FontSettings } from '../font-settings.ts'
import { FontFamilyRow, type FontFamilyRowInjected } from './FontFamilyRow.tsx'
import { FontRuntime } from './font-runtime.ts'
import { en, FONT_LOCALE_NAMESPACE, zh } from './locales.ts'
import { createFontRowStore } from './settings-store.ts'

export type { FontFamilyRowComponentProps, FontFamilyRowInjected } from './FontFamilyRow.tsx'
export type { FontRowState } from './settings-store.ts'

/**
 * Required services: the settings transport, the slots/locale pair the row
 * registers through, `remote`, which carries the forwarded settings
 * invalidation `ctx.settingsScope.bind()` subscribes to on this context, and
 * `theme`, whose token-override layer is how the chosen font reaches the
 * document.
 */
export const inject = ['slots', 'locale', 'remote', 'settingsScope', 'theme']

/**
 * Client plugin body: own the font runtime and register the Font preference
 * row into the General section's item slot.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const host: SettingsScope<FontSettings> = ctx.settingsScope.bind<FontSettings>({ namespace: FONT_SETTINGS_NAMESPACE })

  ctx.effect(
    () => ctx.locale.register(FONT_LOCALE_NAMESPACE, { zh, en }),
    'ui-font-family: settings row dictionaries',
  )

  const store = createFontRowStore()
  let bound: BoundActions<typeof store> | undefined
  const runtime = new FontRuntime(host, ctx.theme)
  const stopHost = runtime.start()
  const sync = (): void => { bound?.sync(runtime.getSnapshot()) }
  const stopSync = runtime.subscribe(sync)
  ctx.effect(() => () => {
    stopSync()
    stopHost()
    runtime.dispose()
  }, 'ui-font-family: font runtime')

  const injected = (actions: BoundActions<typeof store>): FontFamilyRowInjected => {
    bound = actions
    // Re-sync from the live snapshot so no change is lost between registration
    // and first render; the store's sequence guard drops stale duplicates.
    sync()
    return {
      select: (source, id) => { runtime.select(source, id) },
      reset: () => { runtime.reset() },
      reload: (options) => { runtime.reloadCatalog(options) },
      upload: (file) => { runtime.upload(file) },
      remove: (id) => { runtime.remove(id) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'font-family',
    // Between the font-size row (11, owned by ui-theme) and the transcript-view
    // row (12, owned by ui-chat): "the font size, then the font".
    order: 11.5,
    store,
    locale: FONT_LOCALE_NAMESPACE,
    inject: injected,
  }, FontFamilyRow))
}
