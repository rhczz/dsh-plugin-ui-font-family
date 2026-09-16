/**
 * Font picker: a searchable, grouped list of every font the user can choose,
 * each row drawn in the font it names, with the management entry point and the
 * default-restoring action in its footer.
 *
 * A dialog rather than a dropdown menu because the installed-font list runs to
 * hundreds of entries and needs a search field; the menu primitive pins only
 * menu rows below its scroller, so it cannot carry one.
 * @module dsh-plugin-ui-font-family/client/FontPickerDialog
 */

import { useState } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconCheckOutline16,
  IconSearchOutline16,
  Input,
  Modal,
  rankByName,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FontSystemUnavailableReason, FontUploadSummary } from '../font-api.ts'
import { FONT_PRESET_IDS, fontPresetFamilies } from '../font-presets.ts'
import { composeFontStack, quoteFontFamily } from '../font-selection.ts'
import type { FontSource } from '../font-settings.ts'
import { FONT_LOCALE_NAMESPACE } from './locales.ts'
import css from './FontPickerDialog.module.css'

/**
 * Installed families listed before the user searches. A machine carries
 * hundreds of them, and listing them all buries the presets and the user's own
 * fonts under a wall of names nobody scrolls; a search is the way in.
 */
const SYSTEM_PREVIEW_ROWS = 5

/** Installed families listed for one search. */
const MAX_SYSTEM_ROWS = 60

/**
 * Narrow the installed families to the ones worth listing.
 *
 * Platforms mark private faces with a leading dot (`.AppleSystemUIFont`,
 * `.SF NS`), and sampling those as "the fonts you have" would open the group
 * with names nobody recognises. A search still reaches them by name.
 * @param system - families the Host enumerated.
 * @param searching - whether the user has typed a query.
 * @returns the families to rank.
 */
function offered(system: readonly string[], searching: boolean): readonly string[] {
  return searching ? system : system.filter(name => !name.startsWith('.'))
}

/** One selectable font. */
interface FontOption {
  /** Catalogue the option belongs to. */
  source: FontSource
  /** Id within that catalogue. */
  id: string
  /** Text shown in the row. */
  label: string
  /**
   * Stack the row is drawn in: the families this option would install, ahead of
   * the harness's own stack, so a preview draws the same faces the option does
   * and falls back for Chinese text the way the real thing would. Empty when
   * the option installs nothing.
   */
  stack: string
}

/** Props of the font picker dialog. */
export interface FontPickerDialogProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Row translator, passed down from the registering component. */
  t: TranslateNS<typeof FONT_LOCALE_NAMESPACE>
  /** Catalogue the current selection came from. */
  source: FontSource
  /** Current selection within that catalogue. */
  id: string
  /** Installed families, or null when the Host did not enumerate them. */
  system: readonly string[] | null
  /** Why {@link FontPickerDialogProps.system} is null; null before the first read. */
  systemUnavailable: FontSystemUnavailableReason | null
  /** Stored fonts. */
  uploaded: readonly FontUploadSummary[]
  /** Stack the harness declares for itself; every preview appends it. */
  harnessStack: string
  /** Select one font. */
  onSelect: (source: FontSource, id: string) => void
  /** Restore the profile's default font. */
  onReset: () => void
  /** Open the management dialog. */
  onManage: () => void
  /** Close the dialog. */
  onClose: () => void
}

/**
 * Render one selectable font row.
 * @param props - option, selection state, and the select callback.
 * @returns the row element tree.
 */
function OptionRow({ option, selected, onSelect }: {
  option: FontOption
  selected: boolean
  onSelect: (option: FontOption) => void
}) {
  return (
    <button
      type="button"
      className={clsx(css.option, selected && css.optionSelected)}
      aria-pressed={selected}
      onClick={() => { onSelect(option) }}
    >
      <span className={css.optionName} style={{ fontFamily: option.stack }}>{option.label}</span>
      {selected && <IconCheckOutline16 className={css.check} />}
    </button>
  )
}

/**
 * Render the font picker dialog.
 * @param props - catalogue data and callbacks.
 * @returns the dialog element tree.
 */
export function FontPickerDialog({
  open, t, source, id, system, systemUnavailable, uploaded, harnessStack, onSelect, onReset, onManage, onClose,
}: FontPickerDialogProps) {
  const [query, setQuery] = useState('')

  // Previewing goes through the same composition installing does, so a row
  // cannot promise a stack the selection would not produce. A selection that
  // names no family of its own previews the harness stack itself: inheriting
  // would draw it in whichever font is installed right now.
  const preview = (families: string): string =>
    families === '' ? harnessStack : composeFontStack(families, harnessStack) ?? ''

  const presets: FontOption[] = FONT_PRESET_IDS.map(preset => ({
    source: 'preset',
    id: preset,
    label: t(`preset.${preset}`),
    stack: preview(fontPresetFamilies(preset)),
  }))

  const trimmed = query.trim()
  const searching = trimmed !== ''

  const stored: FontOption[] = rankByName(
    uploaded.map(entry => ({ name: entry.family, id: entry.id })),
    trimmed,
  ).map(entry => ({
    source: 'upload',
    id: entry.id,
    label: entry.name,
    stack: preview(quoteFontFamily(entry.name)),
  }))

  const matched = system === null ? [] : rankByName(offered(system, searching).map(name => ({ name })), trimmed)
  const installed: FontOption[] = matched
    .slice(0, searching ? MAX_SYSTEM_ROWS : SYSTEM_PREVIEW_ROWS)
    .map(entry => ({
      source: 'system',
      id: entry.name,
      label: entry.name,
      stack: preview(quoteFontFamily(entry.name)),
    }))

  // Four different situations produce a short installed group, and naming the
  // wrong one would tell the user something false about their own machine.
  const systemNote = system === null
    ? systemUnavailable === null
      ? t('system.unread')
      : systemUnavailable === 'disabled' ? t('system.disabled') : t('system.remote')
    : system.length === 0
      ? t('system.empty')
      : searching
        ? matched.length === 0
          ? t('search.empty')
          : matched.length > MAX_SYSTEM_ROWS ? t('search.truncated') : undefined
        : system.length > SYSTEM_PREVIEW_ROWS ? t('system.more', { count: system.length }) : undefined

  const choose = (option: FontOption): void => {
    onSelect(option.source, option.id)
    onClose()
  }

  // Nothing long enough to search when neither installed nor stored fonts are
  // available; a search field that cannot narrow anything is dead chrome.
  const searchable = system !== null || uploaded.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('picker.title')}
      closeLabel={t('action.close')}
      description={t('picker.description')}
      className={clsx(css.picker)}
      footer={(
        <>
          <Button variant="ghost" className={css.leadAction} onClick={onManage}>{t('action.manage')}</Button>
          <Button variant="outline" onClick={onReset}>{t('action.reset')}</Button>
          <Button variant="primary" onClick={onClose}>{t('action.close')}</Button>
        </>
      )}
    >
      {searchable && (
        <Input
          icon={<IconSearchOutline16 />}
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      )}

      <div className={css.groups}>
        <div className={css.groupLabel}>{t('group.presets')}</div>
        {presets.map(option => (
          <OptionRow
            key={`${option.source}:${option.id}`}
            option={option}
            selected={option.source === source && option.id === id}
            onSelect={choose}
          />
        ))}

        {stored.length > 0 && <div className={css.groupLabel}>{t('group.uploaded')}</div>}
        {stored.map(option => (
          <OptionRow
            key={`${option.source}:${option.id}`}
            option={option}
            selected={option.source === source && option.id === id}
            onSelect={choose}
          />
        ))}

        <div className={css.groupLabel}>{t('group.system')}</div>
        {/* Before the rows, not after: the note is what tells the user the list
            is short on purpose and how to see the rest of it. */}
        {systemNote !== undefined && <div className={css.note}>{systemNote}</div>}
        {installed.map(option => (
          <OptionRow
            key={`${option.source}:${option.id}`}
            option={option}
            selected={option.source === source && option.id === id}
            onSelect={choose}
          />
        ))}
      </div>
    </Modal>
  )
}
