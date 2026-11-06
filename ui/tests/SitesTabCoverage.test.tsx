import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { SitesTab } from '../src/SitesTab'
import { t } from '../src/i18n'
import { renderWithProviders } from './helpers'

// The tab's only I/O is the scoped client from `useShopApi()`; every call is
// answered here, so nothing reaches a network.
const shopApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('../src/api', () => ({ useShopApi: () => shopApi }))

const mockGet = shopApi.get
const mockPut = shopApi.put

const K = 'sitesTab'

const acme = { id: 'acme', name: 'Acme Shop', url: 'https://acme.example', enabled: true, loggedIn: false }
const globex = { id: 'globex', name: 'Globex', url: 'https://globex.example', enabled: true, loggedIn: false }

function seed(sites: typeof acme[] = [acme, globex]) {
  mockGet.mockResolvedValue({ sites })
  mockPut.mockResolvedValue(undefined)
}

const openAddForm = () => fireEvent.click(screen.getByText(t(`${K}.add_shopping_site`)))
const nameInput = () => screen.getByPlaceholderText(t(`${K}.site_name_e_g_example_store`))
const urlInput = () => screen.getByPlaceholderText(t(`${K}.url_e_g_store_example_com`))
const addButton = () => screen.getByRole('button', { name: t(`${K}.add_site`) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SitesTab', () => {
  it('shows a loading line while the sites are still on their way', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    renderWithProviders(<SitesTab />)

    expect(screen.getByText(t(`${K}.loading_sites`))).toBeInTheDocument()
  })

  it('lists each configured site with its URL once loaded', async () => {
    seed()
    renderWithProviders(<SitesTab />)

    expect(await screen.findByText('Acme Shop')).toBeInTheDocument()
    expect(screen.getByText('https://acme.example')).toBeInTheDocument()
    expect(screen.getByText('Globex')).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('/sites')
  })

  it('shows the empty state when no sites are configured', async () => {
    seed([])
    renderWithProviders(<SitesTab />)

    expect(await screen.findByText(t(`${K}.no_sites_configured`))).toBeInTheDocument()
  })

  it('removes one site by writing the list without it', async () => {
    seed()
    renderWithProviders(<SitesTab />)

    await screen.findByText('Acme Shop')
    fireEvent.click(screen.getByRole('button', { name: t(`${K}.remove_named_site`, { name: 'Acme Shop' }) }))

    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/sites', { sites: [globex] }))
  })

  it('adds a site with an https prefix when the URL has none, then closes the form', async () => {
    seed([])
    renderWithProviders(<SitesTab />)
    await screen.findByText(t(`${K}.no_sites_configured`))

    openAddForm()
    fireEvent.change(nameInput(), { target: { value: '  Best Buy  ' } })
    fireEvent.change(urlInput(), { target: { value: ' bestbuy.example ' } })
    fireEvent.click(addButton())

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/sites', {
        sites: [
          {
            id: expect.any(String),
            name: 'Best Buy',
            url: 'https://bestbuy.example',
            enabled: true,
            loggedIn: false,
          },
        ],
      }),
    )
    await waitFor(() => expect(screen.queryByPlaceholderText(t(`${K}.url_e_g_store_example_com`))).not.toBeInTheDocument())
  })

  it('keeps a URL that already starts with http as typed', async () => {
    seed([])
    renderWithProviders(<SitesTab />)
    await screen.findByText(t(`${K}.no_sites_configured`))

    openAddForm()
    fireEvent.change(nameInput(), { target: { value: 'Plain' } })
    fireEvent.change(urlInput(), { target: { value: 'http://plain.example' } })
    fireEvent.click(addButton())

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/sites', {
        sites: [expect.objectContaining({ name: 'Plain', url: 'http://plain.example' })],
      }),
    )
  })

  it('does not enable add until both name and URL have text', async () => {
    seed([])
    renderWithProviders(<SitesTab />)
    await screen.findByText(t(`${K}.no_sites_configured`))

    openAddForm()
    expect(addButton()).toBeDisabled()
    fireEvent.change(nameInput(), { target: { value: 'Only a name' } })
    expect(addButton()).toBeDisabled()
    fireEvent.change(urlInput(), { target: { value: 'x.example' } })
    expect(addButton()).toBeEnabled()
  })

  it('cancel closes the form and discards what was typed', async () => {
    seed([])
    renderWithProviders(<SitesTab />)
    await screen.findByText(t(`${K}.no_sites_configured`))

    openAddForm()
    fireEvent.change(nameInput(), { target: { value: 'Draft' } })
    fireEvent.click(screen.getByRole('button', { name: t(`${K}.cancel`) }))

    expect(screen.queryByPlaceholderText(t(`${K}.site_name_e_g_example_store`))).not.toBeInTheDocument()
    openAddForm()
    expect(nameInput()).toHaveValue('')
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('a rejected save shows its error code and keeps the typed site so it can be retried', async () => {
    seed([])
    mockPut.mockRejectedValue(new Error('quota_exceeded'))
    renderWithProviders(<SitesTab />)
    await screen.findByText(t(`${K}.no_sites_configured`))

    openAddForm()
    fireEvent.change(nameInput(), { target: { value: 'Retry me' } })
    fireEvent.change(urlInput(), { target: { value: 'retry.example' } })
    fireEvent.click(addButton())

    expect(await screen.findByText(/quota_exceeded/)).toBeInTheDocument()
    expect(nameInput()).toHaveValue('Retry me')
    expect(urlInput()).toHaveValue('retry.example')
  })
})
