/**
 * Font family preference row registered into the General section item slot:
 * title, description, and a selector pill that opens the font picker.
 *
 * The pill is drawn in the chosen font, so the row previews the selection
 * without sample text. Picking is frequent and needs a searchable list;
 * uploading and deleting are rare and have their own dialog.
 * @module dsh-plugin-ui-font-family/client/FontFamilyRow
 */

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { IconChevronDownOutline14, IconRefreshOutline14, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FontUploadSummary } from '../font-api.ts'
import { DEFAULT_FONT_PRESET_ID, isFontPresetId, type FontPresetId } from '../font-presets.ts'
import type { FontSource } from '../font-settings.ts'
import { FontManagerDialog } from './FontManagerDialog.tsx'
import { FontPickerDialog } from './FontPickerDialog.tsx'
import { FONT_LOCALE_NAMESPACE } from './locales.ts'
import type { FontCatalogReadOptions } from './font-catalog.ts'
import { isFontNoticeFailure, type FontNotice } from './font-runtime.ts'
import type { createFontRowStore } from './settings-store.ts'
import css from './FontFamilyRow.module.css'

/**
 * Locale key of one preset's label.
 * @param id - preset id.
 * @returns the copy key naming that preset.
 */
function presetKey(id: FontPresetId): `preset.${FontPresetId}` {
  return `preset.${id}`
}

/**
 * Locale key of one write outcome.
 * @param code - outcome code reported by the runtime.
 * @returns the copy key naming that outcome.
 */
function noticeKey(code: Exclude<FontNotice, ''>): `notice.${Exclude<FontNotice, ''>}` {
  return `notice.${code}`
}

/**
 * Name the selected font for the trigger.
 * @param t - row translator.
 * @param source - catalogue the selection came from.
 * @param id - selected id within that catalogue.
 * @param uploaded - uploaded catalogue, consulted for a stored font's family.
 * @returns the label; a stored font absent from a loaded catalogue reports an
 * unknown name rather than an id the user never chose.
 */
function selectionLabel(
  t: TranslateNS<typeof FONT_LOCALE_NAMESPACE>,
  source: FontSource,
  id: string,
  uploaded: readonly FontUploadSummary[],
): string {
  if (source === 'system') return id
  if (source === 'upload') return uploaded.find(entry => entry.id === id)?.family ?? t('fontFamily.unknownName')
  return isFontPresetId(id) ? t(presetKey(id)) : t(presetKey(DEFAULT_FONT_PRESET_ID))
}

/** Injected business face: the selection write and the catalogue operations. */
export interface FontFamilyRowInjected {
  /** Select one font from one catalogue. */
  select: (source: FontSource, id: string) => void
  /** Restore the profile's default font. */
  reset: () => void
  /**
   * Read the catalogue again.
   * @param options - what to ask the Host for beyond the stored fonts; the
   * retry action and the picker's rescan both ask for the installed fonts to
   * be read again.
   */
  reload: (options?: FontCatalogReadOptions) => void
  /** Store one font file and select it. */
  upload: (file: File) => void
  /** Delete one stored font. */
  remove: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type FontFamilyRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createFontRowStore>>
  & PropsLocale<typeof FONT_LOCALE_NAMESPACE> & FontFamilyRowInjected

/**
 * Render the font family row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FontFamilyRow({ t, select, reset, reload, upload, remove, useStore }: FontFamilyRowComponentProps) {
  const source = useStore(s => s.selection.source)
  const id = useStore(s => s.selection.id)
  const stack = useStore(s => s.stack)
  const harnessStack = useStore(s => s.harnessStack)
  const system = useStore(s => s.system)
  const systemUnavailable = useStore(s => s.systemUnavailable)
  const uploaded = useStore(s => s.uploaded)
  const catalog = useStore(s => s.catalog)
  const catalogError = useStore(s => s.catalogError)
  const available = useStore(s => s.available)
  const busy = useStore(s => s.busy)
  const notice = useStore(s => s.notice)
  const noticeDetail = useStore(s => s.noticeDetail)
  const directory = useStore(s => s.directory)

  const [picking, setPicking] = useState(false)
  const [managing, setManaging] = useState(false)

  const label = selectionLabel(t, source, id, uploaded)
  const triggerStyle: CSSProperties = stack === '' ? {} : { fontFamily: stack }
  const failed = isFontNoticeFailure(notice)
  // The retry control and the picker's rescan ask the Host for the same thing:
  // a font installed on this machine is a change no request can observe.
  const readInstalled = (): void => { reload({ system: true }) }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('fontFamily.title')}</div>
        <div className={css.desc}>{t('fontFamily.description')}</div>
        {!available && (
          <div className={css.missing}>
            <IconWarningOutline16 className={css.missingIcon} />
            {t('fontFamily.missing')}
          </div>
        )}
        {notice !== '' && (
          <div className={failed ? css.noticeFailed : css.notice}>
            {t(noticeKey(notice))}
            {noticeDetail === '' ? '' : ` · ${noticeDetail}`}
          </div>
        )}
        {catalog === 'failed' && (
          <div className={css.noticeFailed}>
            {t('notice.loadFailed')}
            {` · ${catalogError}`}
            <button type="button" className={css.retry} onClick={readInstalled}>
              <IconRefreshOutline14 />
              {t('action.retry')}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className={css.selector}
        aria-label={t('fontFamily.trigger')}
        aria-haspopup="dialog"
        aria-expanded={picking}
        onClick={() => { setPicking(true) }}
      >
        <span className={css.selectorLabel} style={triggerStyle}>{label}</span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>

      <FontPickerDialog
        open={picking}
        t={t}
        source={source}
        id={id}
        system={system}
        systemUnavailable={systemUnavailable}
        uploaded={uploaded}
        harnessStack={harnessStack}
        onSelect={select}
        onReset={reset}
        onRescan={readInstalled}
        onManage={() => { setPicking(false); setManaging(true) }}
        onClose={() => { setPicking(false) }}
      />

      <FontManagerDialog
        open={managing}
        t={t}
        directory={directory}
        uploaded={uploaded}
        busy={busy}
        onUpload={upload}
        onRemove={remove}
        // Only one dialog is open at a time, so the manager takes over from the
        // picker and hands it back: a font is usually uploaded in order to
        // choose it, and closing the manager onto the settings page would make
        // the user reopen the picker to finish what they started.
        onClose={() => { setManaging(false); setPicking(true) }}
      />
    </div>
  )
}
