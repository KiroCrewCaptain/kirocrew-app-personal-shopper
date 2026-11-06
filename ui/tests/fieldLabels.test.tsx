/**
 * Every Personal Shopper text field has an accessible name. A placeholder is not
 * one: it vanishes once text is typed, and assistive tech may skip it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { PreferencesTab } from '../src/PreferencesTab'
import { SitesTab } from '../src/SitesTab'
import { HistoryTab } from '../src/HistoryTab'
import { CATALOGS } from '../src/i18n'
import { stubLocale } from './stubs/app-sdk'
import { renderWithProviders } from './helpers'

const shopApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('../src/api', () => ({ useShopApi: () => shopApi }))

const zhHistory = CATALOGS['zh-CN'].historyTab as Record<string, string>

beforeEach(() => {
  shopApi.get.mockImplementation(async (path: string) => {
    if (path === '/preferences') return { preferences: [] }
    if (path === '/groups') return { groups: [] }
    if (path === '/sites') return { sites: [] }
    return { sessions: [] }
  })
})

describe('Personal Shopper field names', () => {
  it('names the new preference and group name fields', async () => {
    renderWithProviders(<PreferencesTab />)
    expect(await screen.findByRole('textbox', { name: 'New preference' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }))
    expect(screen.getByRole('textbox', { name: 'Group name' })).toBeInTheDocument()
  })

  it('names the site name and URL fields', async () => {
    renderWithProviders(<SitesTab />)
    fireEvent.click(await screen.findByText('Add shopping site'))
    expect(screen.getByRole('textbox', { name: 'Site name' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Site URL' })).toBeInTheDocument()
  })

  it('names the history search field', async () => {
    renderWithProviders(<HistoryTab />)
    expect(await screen.findByRole('textbox', { name: 'Search past sessions' })).toBeInTheDocument()
  })

  it('takes the names from the catalog in another language', async () => {
    stubLocale('zh-CN')
    renderWithProviders(<HistoryTab />)
    expect(await screen.findByRole('textbox', { name: zhHistory.search_label })).toBeInTheDocument()
  })
})
