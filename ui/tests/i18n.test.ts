/**
 * The app's own catalogs and the lookup over them.
 *
 * The bundle cannot read the dashboard's catalogs, so a missing key here is an
 * untranslated (or raw-key) string on screen in that locale. These pin the
 * fallback order and that every shipped locale covers every English key with the
 * same placeholders.
 */
import { describe, it, expect } from 'vitest'
import { CATALOGS, localeChain, t } from '../src/i18n'
import { stubLocale } from './stubs/app-sdk'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') out[prefix + key] = value
    else Object.assign(out, flatten(value, `${prefix}${key}.`))
  }
  return out
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()

describe('lookup order', () => {
  it('uses the exact locale first', () => {
    stubLocale('zh-CN')
    expect(t('preferencesTab.add')).toBe(flatten(CATALOGS['zh-CN'])['preferencesTab.add'])
    expect(t('preferencesTab.add')).not.toBe('Add')
  })

  it('falls back to the base language for a regional variant', () => {
    stubLocale('pt-BR')
    expect(localeChain('pt-BR')).toEqual(['pt', 'en'])
    expect(t('preferencesTab.add')).toBe(flatten(CATALOGS.pt)['preferencesTab.add'])
  })

  it('falls back to English for a language it does not ship', () => {
    stubLocale('sv')
    expect(localeChain('sv')).toEqual(['en'])
    expect(t('preferencesTab.add')).toBe('Add')
  })

  it('shows the key when no catalog has it', () => {
    expect(t('nope.not_a_key')).toBe('nope.not_a_key')
    expect(t('preferencesTab')).toBe('preferencesTab')
  })

  it('does not read inherited object properties as keys', () => {
    expect(t('constructor')).toBe('constructor')
    expect(t('preferencesTab.toString')).toBe('preferencesTab.toString')
  })
})

describe('interpolation', () => {
  it('fills placeholders and leaves an unsupplied one as written', () => {
    expect(t('preferencesTab.delete_named_group', { name: 'Footwear' })).toBe('Delete group Footwear')
    expect(t('preferencesTab.delete_named_group')).toBe('Delete group {{name}}')
  })
})

describe('catalog coverage', () => {
  const english = flatten(CATALOGS.en)

  it('ships every dashboard locale', () => {
    expect(Object.keys(CATALOGS).sort()).toEqual(
      ['bn', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'ru', 'zh-CN'].sort(),
    )
  })

  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    it(`${locale} has exactly the English keys, with the same placeholders`, () => {
      const strings = flatten(catalog)
      expect(Object.keys(strings).sort()).toEqual(Object.keys(english).sort())
      for (const [key, text] of Object.entries(strings)) {
        expect(text.trim(), `${locale} ${key}`).not.toBe('')
        expect(placeholders(text), `${locale} ${key}`).toEqual(placeholders(english[key]))
      }
    })
  }
})
