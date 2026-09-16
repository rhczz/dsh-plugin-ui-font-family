// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FontFamilyRow, type FontFamilyRowComponentProps } from '../../src/client/FontFamilyRow.tsx'
import { zh } from '../../src/client/locales.ts'
import { createFontRowStore, type FontRowState } from '../../src/client/settings-store.ts'
import { composeFontStack } from '../../src/font-selection.ts'
import { normalizeStack } from '../css-text.ts'
import type { FontRowSnapshot } from '../../src/client/font-runtime.ts'

type RowInstance = ReturnType<ReturnType<typeof createFontRowStore>['create']>

/** Stored font the catalogue cases list. */
const STORED_FONT = { id: 'silkscreen-1a2b3c4d.ttf', family: 'Silkscreen' }

/** Stack the harness declares for itself; every preview appends it. */
const HARNESS_STACK = "-apple-system, 'PingFang SC', sans-serif"

afterEach(cleanup)

/** Copy the row renders, taken from the shipped dictionary. */
const t = ((key: string, params?: Record<string, unknown>) => {
  const template = (zh as Record<string, string>)[key] ?? key
  // Interpolate like the locale service, so a spec sees the text a user sees.
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}) as FontFamilyRowComponentProps['t']

/**
 * Bind a real store instance to the `useStore` seat the row is handed.
 * @param instance - live store instance from the declared factory.
 * @returns the selector hook the slot renderer would supply.
 */
function bindStore(instance: RowInstance): FontFamilyRowComponentProps['useStore'] {
  const hook = <T,>(selector: (state: FontRowState) => T): T =>
    useSyncExternalStore(listener => instance.subscribe(listener), () => selector(instance.getSnapshot()))
  return hook as unknown as FontFamilyRowComponentProps['useStore']
}

/**
 * Build a runtime snapshot with everything a case does not care about fixed.
 * @param overrides - fields this case exercises.
 * @returns the snapshot.
 */
function snapshot(overrides: Partial<FontRowSnapshot> = {}): FontRowSnapshot {
  return {
    seq: 0,
    selection: { source: 'preset', id: 'default' },
    catalog: 'ready',
    catalogError: '',
    directory: '/home/example/.dsh/fonts',
    system: ['Georgia'],
    systemUnavailable: null,
    uploaded: [],
    stack: '',
    harnessStack: HARNESS_STACK,
    available: true,
    busy: false,
    notice: '',
    noticeDetail: '',
    ...overrides,
  }
}

/** The injected face a case asserts against. */
function face() {
  return {
    select: vi.fn(),
    reset: vi.fn(),
    reload: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
  }
}

/**
 * Mount the row over a driven store.
 * @param overrides - snapshot fields this case exercises.
 * @returns the rendered store instance and the injected callbacks.
 */
function mount(overrides: Partial<FontRowSnapshot> = {}) {
  const instance = createFontRowStore().create()
  instance.actions.sync(snapshot({ seq: 1, ...overrides }))
  const injected = face()
  const props = {
    t,
    useStore: bindStore(instance),
    ...injected,
    // The row reads none of the global runtime seats; the four shares it does
    // read are supplied here in full.
  } as unknown as FontFamilyRowComponentProps
  const view = render(<FontFamilyRow {...props} />)
  return { instance, injected, view }
}

/** The trigger button showing the current selection. */
function trigger(): HTMLElement {
  return screen.getByRole('button', { name: zh['fontFamily.trigger'] })
}

/**
 * Read one dialog by its accessible title.
 * @param name - localized dialog title.
 * @returns the dialog element.
 */
function dialog(name: string): HTMLElement {
  return screen.getByRole('dialog', { name })
}

/** The picker dialog, once open. */
function picker(): HTMLElement {
  return dialog(zh['picker.title'])
}

/** Open the picker, then the manager from its footer. */
function openManager(): void {
  fireEvent.click(trigger())
  fireEvent.click(screen.getByRole('button', { name: zh['action.manage'] }))
}

/** The surface a font file is dropped onto, read off the field it wraps. */
function dropzone(): HTMLElement {
  const input = document.querySelector('input[type="file"]')
  if (input?.parentElement == null) throw new Error('the manager is not open')
  return input.parentElement
}

describe('the font row', () => {
  it('names itself and its effect', () => {
    mount()
    expect(screen.getByText(zh['fontFamily.title'])).toBeDefined()
    expect(screen.getByText(zh['fontFamily.description'])).toBeDefined()
  })

  it('shows the selected preset by its localized name', () => {
    mount()
    expect(trigger().textContent).toContain(zh['preset.default'])
  })

  it('draws the trigger in the font it names', () => {
    mount({ selection: { source: 'system', id: 'Georgia' }, stack: 'Georgia, sans-serif' })
    expect(trigger().querySelector('span')?.getAttribute('style')).toContain('Georgia')
  })

  it('shows a stored font by the family its file declares', () => {
    mount({
      selection: { source: 'upload', id: STORED_FONT.id },
      uploaded: [STORED_FONT],
      stack: `'${STORED_FONT.family}', sans-serif`,
    })
    expect(trigger().textContent).toContain(STORED_FONT.family)
  })

  it('falls back to a neutral name when a stored font is no longer listed', () => {
    mount({ selection: { source: 'upload', id: 'gone.ttf' }, available: false })
    expect(trigger().textContent).toContain(zh['fontFamily.unknownName'])
  })

  it('falls back to the default name when the stored preset is not one this build ships', () => {
    // A downgrade or a hand-edited settings.yaml can name a preset that is
    // gone. The row still has to name something rather than render an empty
    // trigger or an untranslated key.
    mount({ selection: { source: 'preset', id: 'comic' }, available: false })
    expect(trigger().textContent).toContain(zh['preset.default'])
  })

  it('draws the trigger in the default face when no stack resolves', () => {
    // Before the first read there is nothing to install. No style attribute at
    // all means the trigger inherits the row's own font rather than an empty
    // family, which would fall back to the browser default.
    mount({ stack: '' })
    expect(trigger().querySelector('span')?.getAttribute('style')).toBeNull()
  })

  it('marks a failed outcome apart from a successful one', () => {
    mount({ notice: 'uploadFailed', noticeDetail: 'uploaded bytes are not a font' })
    expect(screen.getByText(new RegExp(zh['notice.uploadFailed'] as string))).toBeDefined()
  })

  it('shows a notice that carries no detail on its own', () => {
    mount({ notice: 'reset' })
    expect(screen.getByText(zh['notice.reset'])).toBeDefined()
  })

  it('warns when the chosen font cannot be resolved', () => {
    mount({ selection: { source: 'upload', id: 'gone.ttf' }, available: false })
    expect(screen.getByText(zh['fontFamily.missing'])).toBeDefined()
  })

  it('says nothing about availability while the selection resolves', () => {
    mount()
    expect(screen.queryByText(zh['fontFamily.missing'])).toBeNull()
  })

  it('reports the outcome of the last write with its detail', () => {
    mount({ notice: 'uploaded', noticeDetail: 'Silkscreen' })
    expect(screen.getByText(new RegExp(zh['notice.uploaded']))).toBeDefined()
    expect(screen.getByText(/Silkscreen/)).toBeDefined()
  })

  it('offers a retry when the catalogue could not be read, and drives it', () => {
    const { injected } = mount({ catalog: 'failed', catalogError: 'connect ECONNREFUSED' })
    expect(screen.getByText(/connect ECONNREFUSED/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['action.retry']) }))
    expect(injected.reload).toHaveBeenCalledTimes(1)
  })

  it('keeps quiet about a catalogue it has not read yet', () => {
    mount({ catalog: 'loading' })
    expect(screen.queryByText(new RegExp(zh['notice.loadFailed']))).toBeNull()
  })
})

describe('the picker the row opens', () => {
  it('opens on the trigger and lists the presets and the system fonts', () => {
    mount({ system: ['Georgia', 'Silkscreen'] })
    fireEvent.click(trigger())
    const dialog = picker()
    expect(dialog.textContent).toContain(zh['preset.mono'])
    expect(dialog.textContent).toContain('Georgia')
    expect(dialog.textContent).toContain('Silkscreen')
  })

  it('selects a preset and closes', () => {
    const { injected } = mount()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: zh['preset.serif'] }))
    expect(injected.select).toHaveBeenCalledWith('preset', 'serif')
    expect(screen.queryByRole('dialog', { name: zh['picker.title'] })).toBeNull()
  })

  it('selects a system font by its CSS family name', () => {
    const { injected } = mount({ system: ['Georgia'] })
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: 'Georgia' }))
    expect(injected.select).toHaveBeenCalledWith('system', 'Georgia')
  })

  it('narrows the system list by the search term', () => {
    mount({ system: ['Georgia', 'Silkscreen'] })
    fireEvent.click(trigger())
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: 'silk' } })
    const dialog = picker()
    expect(dialog.textContent).toContain('Silkscreen')
    expect(dialog.textContent).not.toContain('Georgia')
  })

  it('opens the installed group with names a user recognises', () => {
    mount({ system: ['.AppleSystemUIFont', '.SF NS', 'Arial', 'Georgia'] })
    fireEvent.click(trigger())
    const text = picker().textContent ?? ''
    expect(text).toContain('Arial')
    expect(text).not.toContain('.SF NS')
  })

  it('still reaches a private family when it is named exactly', () => {
    mount({ system: ['.AppleSystemUIFont', 'Arial'] })
    fireEvent.click(trigger())
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: 'applesystem' } })
    expect(picker().textContent).toContain('.AppleSystemUIFont')
  })

  it('says so when a search matches nothing', () => {
    mount({ system: ['Georgia'] })
    fireEvent.click(trigger())
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: 'zzz' } })
    expect(picker().textContent).toContain(zh['search.empty'])
  })

  it('previews a few installed fonts and names the total behind them', () => {
    const system = Array.from({ length: 40 }, (_, index) => `Font ${String(index).padStart(2, '0')}`)
    mount({ system })
    fireEvent.click(trigger())
    const listed = screen.getAllByRole('button').filter(node => /^Font \d\d$/.test(node.textContent ?? ''))
    // A machine carries hundreds of families, and listing them all would bury
    // the presets and the user's own fonts under names nobody scrolls past.
    expect(listed).toHaveLength(5)
    expect(picker().textContent).toContain(zh['system.more'].replace('{count}', '40'))
  })

  it('lists every match once the user searches', () => {
    const system = Array.from({ length: 40 }, (_, index) => `Font ${String(index).padStart(2, '0')}`)
    mount({ system })
    fireEvent.click(trigger())
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: 'font' } })
    const listed = screen.getAllByRole('button').filter(node => /^Font \d\d$/.test(node.textContent ?? ''))
    expect(listed).toHaveLength(40)
    expect(picker().textContent).not.toContain(zh['search.truncated'])
  })

  it('says the list was cut when a search matches more than it can show', () => {
    const system = Array.from({ length: 80 }, (_, index) => `Font ${String(index).padStart(2, '0')}`)
    mount({ system })
    fireEvent.click(trigger())
    fireEvent.change(screen.getByPlaceholderText(zh['search.placeholder']), { target: { value: 'font' } })
    const listed = screen.getAllByRole('button').filter(node => /^Font \d\d$/.test(node.textContent ?? ''))
    expect(listed).toHaveLength(60)
    expect(picker().textContent).toContain(zh['search.truncated'])
  })

  it('draws every option in the font it offers', () => {
    // The preview is the point of the dialog: a name in the user's current
    // font says nothing about what choosing it would look like.
    mount({
      system: ['Georgia'],
      uploaded: [STORED_FONT],
      selection: { source: 'preset', id: 'default' },
    })
    fireEvent.click(trigger())

    const drawn = (label: string): string | null | undefined =>
      screen.getByText(label).getAttribute('style')

    // The serif assertion names a family only that preset's stack carries, so
    // rendering the wrong preset's stack on the row would fail it.
    expect(drawn(zh['preset.serif'] as string)).toContain('Songti SC')
    expect(drawn('Georgia')).toContain('Georgia')
    expect(drawn(STORED_FONT.family)).toContain(STORED_FONT.family)
  })

  it('draws the option that asks for the harness font in the harness font', () => {
    // A stored font is installed, so a row that named no family at all would
    // inherit that one and show the wrong face for what choosing it does.
    mount({
      selection: { source: 'upload', id: STORED_FONT.id },
      uploaded: [STORED_FONT],
      stack: composeFontStack(STORED_FONT.family, HARNESS_STACK) ?? '',
    })
    fireEvent.click(trigger())

    const style = screen.getByText(zh['preset.default'] as string).getAttribute('style') ?? ''
    expect(normalizeStack(style)).toContain(normalizeStack(HARNESS_STACK))
    expect(style).not.toContain(STORED_FONT.family)
  })

  it('explains why the installed fonts are missing instead of showing an empty group', () => {
    mount({ system: null, systemUnavailable: 'remote' })
    fireEvent.click(trigger())
    expect(picker().textContent).toContain(zh['system.remote'])
    expect(screen.queryByPlaceholderText(zh['search.placeholder'])).toBeNull()
  })

  it('distinguishes a disabled scan from a remote browser', () => {
    mount({ system: null, systemUnavailable: 'disabled' })
    fireEvent.click(trigger())
    expect(picker().textContent).toContain(zh['system.disabled'])
  })

  it('claims no reason at all before the first read', () => {
    mount({ system: null, systemUnavailable: null, catalog: 'loading' })
    fireEvent.click(trigger())
    const text = picker().textContent ?? ''
    expect(text).toContain(zh['system.unread'])
    // Telling a local user their browser is somewhere else would be a false
    // statement about their own machine.
    expect(text).not.toContain(zh['system.remote'])
  })

  it('says the machine has no installed fonts when the scan found none', () => {
    // A successful scan that found nothing is not the same as a scan that
    // could not run, and the difference is the user's own machine.
    mount({ system: [], uploaded: [STORED_FONT] })
    fireEvent.click(trigger())
    const text = picker().textContent ?? ''
    expect(text).toContain(zh['system.empty'])
    expect(text).not.toContain(zh['system.unread'])
  })

  it('drives the reset action and closes', () => {
    const { injected } = mount()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: zh['action.reset'] }))
    expect(injected.reset).toHaveBeenCalledTimes(1)
  })
})

describe('the manager the picker opens', () => {
  it('names the storage directory and lists the stored fonts', () => {
    mount({ uploaded: [STORED_FONT] })
    openManager()
    const manager = dialog(zh['manager.title'])
    expect(manager.textContent).toContain('/home/example/.dsh/fonts')
    expect(manager.textContent).toContain(STORED_FONT.family)
  })

  it('says an empty catalogue is empty rather than showing nothing', () => {
    mount()
    openManager()
    expect(screen.getByText(zh['uploaded.empty'])).toBeDefined()
  })

  it('confirms before deleting and reports the font it is about to delete', () => {
    const { injected } = mount({ uploaded: [STORED_FONT] })
    openManager()
    fireEvent.click(screen.getByRole('button', { name: `${zh['action.remove']} ${STORED_FONT.family}` }))
    expect(injected.remove).not.toHaveBeenCalled()
    const confirm = dialog(zh['confirm.title'])
    expect(confirm.textContent).toContain(STORED_FONT.family)
    fireEvent.click(within(confirm).getAllByRole('button', { name: zh['confirm.confirm'] })[0] as HTMLElement)
    expect(injected.remove).toHaveBeenCalledWith(STORED_FONT.id)
  })

  it('leaves the font alone when the confirmation is dismissed', () => {
    const { injected } = mount({ uploaded: [STORED_FONT] })
    openManager()
    fireEvent.click(screen.getByRole('button', { name: `${zh['action.remove']} ${STORED_FONT.family}` }))
    const confirm = dialog(zh['confirm.title'])
    // The header close control and the footer button carry the same label; the
    // footer is the one a user reaches for.
    const cancels = within(confirm).getAllByRole('button', { name: zh['confirm.cancel'] })
    fireEvent.click(cancels[cancels.length - 1] as HTMLElement)
    expect(injected.remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: zh['confirm.title'] })).toBeNull()
    // The manager is still open behind it, with the font still listed.
    expect(dialog(zh['manager.title']).textContent).toContain(STORED_FONT.family)
  })

  it('leaves the font alone when the confirmation is closed from its own control', () => {
    // The header control, the mask and Escape all route through the dialog's
    // own close, which is a different path from the footer button.
    const { injected } = mount({ uploaded: [STORED_FONT] })
    openManager()
    fireEvent.click(screen.getByRole('button', { name: `${zh['action.remove']} ${STORED_FONT.family}` }))
    const confirm = dialog(zh['confirm.title'])
    const cancels = within(confirm).getAllByRole('button', { name: zh['confirm.cancel'] })
    fireEvent.click(cancels[0] as HTMLElement)
    expect(injected.remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: zh['confirm.title'] })).toBeNull()
  })

  it('hands a chosen file to the upload action', async () => {
    const { injected } = mount()
    openManager()
    const input = document.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    const file = new File(['font bytes'], 'Silkscreen-Regular.ttf')
    await act(async () => {
      fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })
    })
    expect(injected.upload).toHaveBeenCalledWith(file)
  })

  it('accepts the same file again after a refusal', async () => {
    // The input keeps no value of its own, so re-picking a refused file would
    // fire no change event at all if the field were left populated.
    const { injected } = mount()
    openManager()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['not a font'], 'notes.txt')
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    expect(input.value).toBe('')
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    expect(injected.upload).toHaveBeenCalledTimes(2)
  })

  it('opens the file picker from the browse button', () => {
    mount()
    openManager()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: zh['manager.browse'] }))
    expect(click).toHaveBeenCalled()
  })

  it('uploads a dropped file', async () => {
    const { injected } = mount()
    openManager()
    const file = new File(['font bytes'], 'Alpha.ttf')
    await act(async () => {
      fireEvent.drop(dropzone(), { dataTransfer: { files: [file] } })
    })
    expect(injected.upload).toHaveBeenCalledWith(file)
  })

  it('marks the drop zone while a file is over it, and clears the mark again', () => {
    mount()
    openManager()
    const zone = dropzone()
    const resting = zone.className
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } })
    // Whether the highlight looks different, not which class carries it.
    expect(zone.className).not.toBe(resting)
    fireEvent.dragLeave(zone)
    expect(zone.className).toBe(resting)
  })

  it('still takes a file dropped after a drag left the zone', () => {
    const { injected } = mount()
    openManager()
    const zone = dropzone()
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } })
    fireEvent.dragLeave(zone)
    const file = new File(['font bytes'], 'Alpha.ttf')
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(injected.upload).toHaveBeenCalledWith(file)
  })

  it('refuses another upload while one is in flight', () => {
    const { injected } = mount({ busy: true })
    openManager()
    // Both entry points are out of action until the Host answers, so a slow
    // upload cannot be stacked on itself.
    expect(screen.getByRole('button', { name: zh['manager.browse'] }).hasAttribute('disabled')).toBe(true)
    expect(document.querySelector('input[type="file"]')?.hasAttribute('disabled')).toBe(true)
    fireEvent.drop(dropzone(), { dataTransfer: { files: [new File(['bytes'], 'Alpha.ttf')] } })
    expect(injected.upload).not.toHaveBeenCalled()
  })

  it('says it is uploading while an upload is in flight', () => {
    mount({ busy: true })
    openManager()
    expect(screen.getByText(zh['manager.uploading'])).toBeDefined()
  })

  it('hands the picker back when the manager closes', () => {
    // A font is uploaded in order to choose it. Closing the manager onto the
    // settings page would make the user reopen the picker to finish the job.
    mount({ uploaded: [STORED_FONT] })
    openManager()
    const manager = dialog(zh['manager.title'])
    // The header close control and the footer button carry the same label and
    // both close the dialog; the footer is the one a user reaches for.
    const closes = within(manager).getAllByRole('button', { name: zh['manager.close'] })
    fireEvent.click(closes[closes.length - 1] as HTMLElement)
    expect(screen.queryByRole('dialog', { name: zh['manager.title'] })).toBeNull()
    expect(picker()).toBeDefined()
  })

  it('refuses to delete while an upload is in flight', () => {
    mount({ uploaded: [STORED_FONT], busy: true })
    openManager()
    expect(screen.getByRole('button', { name: `${zh['action.remove']} ${STORED_FONT.family}` })
      .hasAttribute('disabled')).toBe(true)
  })
})
