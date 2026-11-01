/** On a level-1 host the bundle uses the host's own names, not its fallbacks. */
import { describe, it, expect } from 'vitest'
import * as hostUi from '@kirocrew/app-sdk/ui'
import { Select, caution, fmtCurrency } from '../src/hostSdk'
import { stubLocale } from './stubs/app-sdk'

describe('level-1 host', () => {
  it('uses the host select and caution marker', () => {
    expect(Select).toBe(hostUi.Select)
    expect(caution).toBe(hostUi.guideCaution)
  })

  it('formats money in the active locale through the host formatter', () => {
    stubLocale('de')
    expect(fmtCurrency(12.5)).toBe(new Intl.NumberFormat('de', { style: 'currency', currency: 'USD' }).format(12.5))
  })
})
