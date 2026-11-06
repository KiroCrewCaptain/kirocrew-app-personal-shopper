/**
 * The page opens on Preferences and swaps the tab body on selection. The three
 * tabs are stubbed, so this checks the page's own switching only.
 */
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import PersonalShopperPage from '../src/PersonalShopperPage'
import { t } from '../src/i18n'
import { renderWithProviders } from './helpers'

vi.mock('../src/PreferencesTab', async () => {
  const React = await import('react')
  return { PreferencesTab: () => React.createElement('div', null, 'preferences-stub') }
})

vi.mock('../src/HistoryTab', async () => {
  const React = await import('react')
  return { HistoryTab: () => React.createElement('div', null, 'history-stub') }
})

vi.mock('../src/SitesTab', async () => {
  const React = await import('react')
  return { SitesTab: () => React.createElement('div', null, 'sites-stub') }
})

const tab = (key: string) => screen.getByRole('tab', { name: t(`personalShopperPage.${key}`) })

describe('PersonalShopperPage tabs', () => {
  it('shows the preferences tab first and switches to history and sites on selection', async () => {
    renderWithProviders(<PersonalShopperPage />)

    expect(screen.getByText('preferences-stub')).toBeInTheDocument()
    expect(screen.queryByText('history-stub')).not.toBeInTheDocument()

    fireEvent.click(tab('tab_history'))
    expect(await screen.findByText('history-stub')).toBeInTheDocument()
    expect(screen.queryByText('preferences-stub')).not.toBeInTheDocument()

    fireEvent.click(tab('tab_sites'))
    expect(await screen.findByText('sites-stub')).toBeInTheDocument()
    expect(screen.queryByText('history-stub')).not.toBeInTheDocument()

    fireEvent.click(tab('tab_preferences'))
    expect(await screen.findByText('preferences-stub')).toBeInTheDocument()
    expect(screen.queryByText('sites-stub')).not.toBeInTheDocument()
  })
})
