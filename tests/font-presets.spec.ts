import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_PRESET_ID,
  FONT_PRESET_IDS,
  fontPresetFamilies,
  isFontPresetId,
} from '../src/font-presets.ts'

/**
 * Keywords that resolve against the installed faces. The browser ignores every
 * family written after one, so a keyword inside a preset would discard the
 * harness stack appended behind it — the stack whose metrics the interface was
 * laid out for.
 */
const GENERIC_KEYWORDS = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui']

describe('font preset families', () => {
  it('names no family in the preset that means the harness font', () => {
    expect(fontPresetFamilies(DEFAULT_FONT_PRESET_ID)).toBe('')
  })

  it('names no generic keyword in any preset', () => {
    for (const id of FONT_PRESET_IDS) {
      const families = fontPresetFamilies(id).split(',').map(part => part.trim().replaceAll("'", ''))
      for (const keyword of GENERIC_KEYWORDS) expect(families).not.toContain(keyword)
    }
  })

  it('names no Chinese face before a Latin one', () => {
    // A Chinese face placed first also takes Latin text, at metrics the
    // harness's layout was not measured for.
    const chinese = /PingFang|Songti|SimSun|YaHei|Hiragino|Sarasa|Noto Sans CJK|Noto Serif CJK|Noto Sans Mono CJK/
    for (const id of FONT_PRESET_IDS) {
      const families = fontPresetFamilies(id).split(',').map(part => part.trim())
      const firstChinese = families.findIndex(family => chinese.test(family))
      if (firstChinese === -1) continue
      expect(families.slice(firstChinese).every(family => chinese.test(family))).toBe(true)
    }
  })

  it('gives every preset that names a family its own list', () => {
    const named = FONT_PRESET_IDS.map(fontPresetFamilies).filter(families => families !== '')
    expect(new Set(named).size).toBe(named.length)
  })

  it('never ends a list with a comma, so an appended stack is a separate family', () => {
    for (const id of FONT_PRESET_IDS) expect(fontPresetFamilies(id)).not.toMatch(/,\s*$/)
  })
})

describe('isFontPresetId', () => {
  it('accepts every shipped id', () => {
    for (const id of FONT_PRESET_IDS) expect(isFontPresetId(id)).toBe(true)
  })

  it('rejects a name that is not a shipped preset', () => {
    expect(isFontPresetId('Georgia')).toBe(false)
    expect(isFontPresetId('')).toBe(false)
    expect(isFontPresetId('Default')).toBe(false)
  })
})
