/**
 * Font picker: a searchable, grouped list of every font the user can choose,
 * each row drawn in the font it names, with the management entry point and the
 * default-restoring action in its footer.
 *
 * A dialog rather than a dropdown menu because the installed-font list runs to
 * hundreds of entries and needs a search field.
 * @module dsh-plugin-ui-font-family/client/FontPickerDialog
 */

import { useMemo, useState } from 'react'
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
 * hundreds; the presets and uploaded fonts stay visible above them.
 */
const SYSTEM_PREVIEW_ROWS = 5

/**
 * Rows one long group lists. A row is drawn in the font it names, so every
 * listed row is a font request; a search reaches everything behind the cap.
 */
const MAX_PREVIEW_ROWS = 60

/**
 * Narrow the installed families to the ones worth listing. Platforms mark
 * private faces with a leading dot (`.AppleSystemUIFont`); a search reaches
 * them by name.
 * @param system - families the Host enumerated.
 * @param searching - whether the user has typed a query.
 * @returns the families to rank.
 */
function offered(system: readonly string[], searching: boolean): readonly string[] {
  return searching ? system : system.filter(name => !name.startsWith('.'))
}

/**
 * Explain a list the dialog shortened, rendered above the rows it belongs to.
 * @param props - text to show.
 * @returns the note element.
 */
function GroupNote({ text }: { text: string }) {
  return <div className={css.note}>{text}</div>
}

/**
 * Explain the installed-font group: unread, refused, empty, or cut short.
 * @param system - families the Host enumerated, or null when it did not.
 * @param systemUnavailable - why the Host did not enumerate them.
 * @param searching - whether the user has typed a query.
 * @param matched - how many families the query matched.
 * @param t - row translator.
 * @returns the note to show, or undefined when the group needs none.
 */
function systemGroupNote(
  system: readonly string[] | null,
  systemUnavailable: FontSystemUnavailableReason | null,
  searching: boolean,
  matched: number,
  t: TranslateNS<typeof FONT_LOCALE_NAMESPACE>,
): string | undefined {
  if (system === null) {
    if (systemUnavailable === null) return t('system.unread')
    return systemUnavailable === 'disabled' ? t('system.disabled') : t('system.remote')
  }
  if (system.length === 0) return t('system.empty')
  if (!searching) {
    return system.length > SYSTEM_PREVIEW_ROWS ? t('system.more', { count: system.length }) : undefined
  }
  if (matched === 0) return t('search.empty')
  return matched > MAX_PREVIEW_ROWS ? t('search.truncated') : undefined
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
   * the harness's own stack, so the preview falls back exactly as the installed
   * stack does. Empty when the option installs nothing.
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
  /** Read the installed fonts again, after one was installed on this machine. */
  onRescan: () => void
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
  open, t, source, id, system, systemUnavailable, uploaded, harnessStack,
  onSelect, onReset, onRescan, onManage, onClose,
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

  // Ranking reads the whole catalogue, so it is a pure function of what the
  // dialog was handed rather than work redone on every render: a list of a few
  // hundred installed families costs about a millisecond to rank.
  const matchedStored = useMemo(
    () => rankByName(uploaded.map(entry => ({ name: entry.family, id: entry.id })), trimmed),
    [uploaded, trimmed],
  )
  const stored: FontOption[] = matchedStored.slice(0, MAX_PREVIEW_ROWS).map(entry => ({
    source: 'upload',
    id: entry.id,
    label: entry.name,
    stack: preview(quoteFontFamily(entry.name)),
  }))

  const matchedInstalled = useMemo(
    () => system === null ? [] : rankByName(offered(system, searching).map(name => ({ name })), trimmed),
    [system, searching, trimmed],
  )
  const installed: FontOption[] = matchedInstalled
    .slice(0, searching ? MAX_PREVIEW_ROWS : SYSTEM_PREVIEW_ROWS)
    .map(entry => ({
      source: 'system',
      id: entry.name,
      label: entry.name,
      stack: preview(quoteFontFamily(entry.name)),
    }))

  const systemNote = systemGroupNote(system, systemUnavailable, searching, matchedInstalled.length, t)
  const storedNote = matchedStored.length > MAX_PREVIEW_ROWS ? t('search.truncated') : undefined

  const choose = (option: FontOption): void => {
    onSelect(option.source, option.id)
    onClose()
  }

  const row = (option: FontOption) => (
    <OptionRow
      key={`${option.source}:${option.id}`}
      option={option}
      selected={option.source === source && option.id === id}
      onSelect={choose}
    />
  )

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
        {presets.map(option => row(option))}

        {stored.length > 0 && <div className={css.groupLabel}>{t('group.uploaded')}</div>}
        {storedNote !== undefined && <GroupNote text={storedNote} />}
        {stored.map(option => row(option))}

        <div className={clsx(css.groupLabel, css.groupLabelRow)}>
          <span>{t('group.system')}</span>
          {/* Only an enumerated list can be read again: a Host that declined to
              enumerate has nothing to rescan and no reason to be asked. */}
          {system !== null && (
            <button type="button" className={css.rescan} onClick={onRescan}>{t('action.rescan')}</button>
          )}
        </div>
        {systemNote !== undefined && <GroupNote text={systemNote} />}
        {installed.map(option => row(option))}
      </div>
    </Modal>
  )
}
