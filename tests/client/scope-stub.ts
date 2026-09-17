/**
 * One settings scope double, shared by the specs that drive a live settings
 * namespace without a Host.
 * @module dsh-plugin-ui-font-family/tests/client/scope-stub
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FontSettings } from '../../src/font-settings.ts'

/**
 * A settings scope double holding one namespace's layer stack.
 *
 * `mutate` records the operation batch and republishes the resolved value, so
 * a spec can assert both what was written and what the runtime did with the
 * answer — the same information the real scope carries.
 */
export class FakeScope implements Pick<SettingsScope<FontSettings>, 'getSnapshot' | 'subscribe' | 'mutate'> {
  /** Every batch handed to {@link mutate}, in call order. */
  readonly batches: (readonly SettingsPathOpView[])[] = []

  private user: Record<string, unknown> = {}
  private revision = 0
  private snapshot: SettingsScopeSnapshot<FontSettings>
  private readonly listeners = new Set<() => void>()

  /**
   * @param base - composition layer the resolved value falls back to.
   */
  constructor(private readonly base: FontSettings) {
    this.snapshot = this.build()
  }

  /** @returns the current sync snapshot. */
  getSnapshot(): SettingsScopeSnapshot<FontSettings> {
    return this.snapshot
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each change.
   * @returns the disposer.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Apply one operation batch and publish the result.
   * @param ops - ordered field operations.
   */
  async mutate(ops: readonly SettingsPathOpView[]): Promise<void> {
    this.batches.push([...ops])
    for (const op of ops) {
      const field = op.path[0]
      if (field === undefined) continue
      this.user = op.op === 'set'
        ? { ...this.user, [field]: op.value }
        : Object.fromEntries(Object.entries(this.user).filter(([key]) => key !== field))
    }
    this.revision += 1
    this.snapshot = this.build()
    for (const listener of this.listeners) listener()
  }

  /** @returns the scope typed as the runtime consumes it. */
  asScope(): SettingsScope<FontSettings> {
    return this as unknown as SettingsScope<FontSettings>
  }

  /** Publish a change made outside {@link mutate}, the way the Host does. */
  notify(): void {
    for (const listener of this.listeners) listener()
  }

  /** @returns the snapshot with the current layers folded together. */
  private build(): SettingsScopeSnapshot<FontSettings> {
    return {
      status: 'ready',
      value: { ...this.base, ...this.user },
      base: this.base,
      user: Object.keys(this.user).length === 0 ? undefined : { ...this.user },
      revision: this.revision,
      writable: true,
      mode: 'host',
    }
  }
}
