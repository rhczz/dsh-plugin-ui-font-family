/**
 * Font management: upload a font file and delete stored ones. Opened from the
 * picker menu so the picker itself stays a scrollable list of choices, and
 * deletion is confirmed in a second dialog rather than removed on one click.
 * @module dsh-plugin-ui-font-family/client/FontManagerDialog
 */

import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FontUploadSummary } from '../font-api.ts'
import { FONT_FILE_EXTENSIONS } from '../font-formats.ts'
import { FONT_LOCALE_NAMESPACE } from './locales.ts'
import css from './FontManagerDialog.module.css'

/** `accept` attribute for the file picker, derived from the accepted formats. */
const ACCEPT_ATTRIBUTE = FONT_FILE_EXTENSIONS.join(',')

/** Props of the management dialog. */
export interface FontManagerDialogProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Row translator, passed down from the registering component. */
  t: TranslateNS<typeof FONT_LOCALE_NAMESPACE>
  /** Absolute directory uploaded fonts live in, shown so a user can copy files there. */
  directory: string
  /** Fonts already stored. */
  uploaded: readonly FontUploadSummary[]
  /** Whether an upload or deletion is in flight. */
  busy: boolean
  /** Store one font file. */
  onUpload: (file: File) => void
  /** Ask to delete one stored font (the dialog owns the confirmation step). */
  onRemove: (id: string) => void
  /** Close the dialog. */
  onClose: () => void
}

/**
 * Render the font management dialog with its delete confirmation.
 * @param props - dialog data and callbacks.
 * @returns the dialog element tree.
 */
export function FontManagerDialog({
  open, t, directory, uploaded, busy, onUpload, onRemove, onClose,
}: FontManagerDialogProps) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<FontUploadSummary | undefined>(undefined)

  const accept = (files: FileList | null): void => {
    // One upload at a time. The browse button is disabled while one is in
    // flight, and a drop or a pick has to refuse by the same rule instead of
    // starting a second request the disabled button claims is impossible.
    if (busy) return
    const file = files?.[0]
    if (file !== undefined) onUpload(file)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('manager.title')}
        closeLabel={t('manager.close')}
        className={clsx(css.dialog)}
        footer={(
          <Button variant="outline" onClick={onClose}>{t('manager.close')}</Button>
        )}
      >
        <p className={css.description}>{t('manager.description')}</p>
        <code className={css.path}>{directory}</code>

        <div
          className={clsx(css.dropzone, dragging && css.dropzoneActive)}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => { setDragging(false) }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            accept(event.dataTransfer.files)
          }}
        >
          <IconPlusOutline16 className={css.dropIcon} />
          <div className={css.dropTitle}>{busy ? t('manager.uploading') : t('manager.drop')}</div>
          <div className={css.dropRow}>
            <span className={css.dropOr}>{t('manager.or')}</span>
            <Button variant="outline" disabled={busy} onClick={() => { input.current?.click() }}>
              {t('manager.browse')}
            </Button>
          </div>
          <div className={css.hint}>{t('manager.hint')}</div>
          <input
            ref={input}
            type="file"
            className={css.fileInput}
            accept={ACCEPT_ATTRIBUTE}
            disabled={busy}
            onChange={(event) => {
              accept(event.target.files)
              // Clearing lets the same file be chosen again after a refusal.
              event.target.value = ''
            }}
          />
        </div>

        <div className={css.listTitle}>{t('manager.listTitle')}</div>
        {uploaded.length === 0
          ? <div className={css.empty}>{t('uploaded.empty')}</div>
          : (
            <ul className={css.list}>
              {uploaded.map(entry => (
                <li key={entry.id} className={css.entry}>
                  <span className={css.entryName}>{entry.family}</span>
                  <button
                    type="button"
                    className={css.remove}
                    aria-label={`${t('action.remove')} ${entry.family}`}
                    disabled={busy}
                    onClick={() => { setPending(entry) }}
                  >
                    <IconTrashOutline16 />
                  </button>
                </li>
              ))}
            </ul>
          )}
      </Modal>

      <Modal
        open={pending !== undefined}
        onClose={() => { setPending(undefined) }}
        title={t('confirm.title')}
        closeLabel={t('confirm.cancel')}
        description={t('confirm.description')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setPending(undefined) }}>{t('confirm.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pending !== undefined) onRemove(pending.id)
                setPending(undefined)
              }}
            >
              {t('confirm.confirm')}
            </Button>
          </>
        )}
      >
        <div className={css.confirmTarget}>{pending?.family ?? ''}</div>
      </Modal>
    </>
  )
}
