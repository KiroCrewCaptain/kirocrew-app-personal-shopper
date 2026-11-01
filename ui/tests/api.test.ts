/**
 * The scoped client wrapper: paths stay under the app's API prefix, and a
 * refusal surfaces as the backend's machine-readable `code`, never its prose.
 */
import { describe, it, expect, vi } from 'vitest'
import type { AppApi } from '@kirocrew/app-sdk'
import { BASE, shopApiFrom, toCodeError } from '../src/api'

const refusal = (status: number, body: string) =>
  Object.assign(new Error(`API ${status}: ${body}`), { name: 'AppApiError', status, body })

function fakeApi(): AppApi & { [K in 'get' | 'post' | 'put' | 'del']: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn(),
    get: vi.fn().mockResolvedValue({ ok: 1 }),
    post: vi.fn().mockResolvedValue({ id: 'x' }),
    put: vi.fn().mockResolvedValue({ updated: true }),
    del: vi.fn().mockResolvedValue({ deleted: true }),
  }
}

describe('shopApiFrom', () => {
  it('prefixes every path with the app namespace the manifest grants', async () => {
    const api = fakeApi()
    const shop = shopApiFrom(api)
    await shop.get('/preferences')
    await shop.post('/groups', { name: 'A' })
    await shop.put('/sites', { sites: [] })
    await shop.del('/groups/g1')
    expect(api.get).toHaveBeenCalledWith(`${BASE}/preferences`)
    expect(api.post).toHaveBeenCalledWith(`${BASE}/groups`, { name: 'A' })
    expect(api.put).toHaveBeenCalledWith(`${BASE}/sites`, { sites: [] })
    expect(api.del).toHaveBeenCalledWith(`${BASE}/groups/g1`)
    expect(BASE).toBe('/api/apps/personal-shopper')
  })

  it('turns a refusal into its code', async () => {
    const api = fakeApi()
    api.post.mockRejectedValue(refusal(403, '{"error":"owner authorization required","code":"owner_only"}'))
    await expect(shopApiFrom(api).post('/groups', {})).rejects.toThrow(/^owner_only$/)
  })
})

describe('toCodeError', () => {
  it('uses http_<status> when the body has no code', () => {
    expect(() => toCodeError(refusal(502, '<html>bad gateway</html>'))).toThrow(/^http_502$/)
    expect(() => toCodeError(refusal(500, '{"error":"boom"}'))).toThrow(/^http_500$/)
  })

  it('rethrows anything that is not a refusal unchanged', () => {
    const offline = new TypeError('Failed to fetch')
    expect(() => toCodeError(offline)).toThrow(offline)
  })
})
