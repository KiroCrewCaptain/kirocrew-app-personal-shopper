/**
 * On a host older than App Kit level 1 the bundle must still link and render.
 *
 * Such a host's modules simply lack the level-1 names. This file replaces both
 * stubs with that older shape and checks each fallback in `hostSdk.ts`.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@kirocrew/app-sdk', () => ({
  fmtNumber: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat('en', options).format(value),
}))
vi.mock('@kirocrew/app-sdk/ui', () => ({}))

const { Select, caution, fmtCurrency } = await import('../src/hostSdk')
const { default: NativeSelect } = await import('../src/NativeSelect')

describe('level-0 host fallbacks', () => {
  it('formats money through fmtNumber', () => {
    expect(fmtCurrency(12.5)).toBe('$12.50')
    expect(fmtCurrency(3, 'EUR')).toBe('€3.00')
  })

  it('spreads no caution marker', () => {
    expect(caution).toEqual({})
  })

  it('renders a native select with the same props', () => {
    expect(Select).toBe(NativeSelect)
    const onChange = vi.fn()
    render(
      <Select
        options={['g1', 'g2']}
        optionLabels={['Footwear']}
        value=""
        onChange={onChange}
        clearLabel="No group"
        aria-label="Assign to group"
      />,
    )
    const select = screen.getByRole('combobox', { name: 'Assign to group' })
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'No group',
      'Footwear',
      'g2',
    ])
    fireEvent.change(select, { target: { value: 'g2' } })
    expect(onChange).toHaveBeenCalledWith('g2')
  })

  it('keeps an empty row when the held value matches no option', () => {
    render(<NativeSelect options={['g1']} value="" onChange={() => {}} aria-label="pick" />)
    expect(screen.getByRole('combobox', { name: 'pick' })).toHaveValue('')
  })
})
