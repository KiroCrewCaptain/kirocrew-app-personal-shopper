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

  it('maps a refusal to its code on every verb, not only POST', async () => {
    const api = fakeApi()
    api.get.mockRejectedValue(refusal(409, '{"code":"preferences_locked"}'))
    api.put.mockRejectedValue(refusal(400, '{"code":"invalid_field_type"}'))
    api.del.mockRejectedValue(refusal(404, '{"code":"not_found"}'))
    const shop = shopApiFrom(api)
    await expect(shop.get('/preferences')).rejects.toThrow(/^preferences_locked$/)
    await expect(shop.put('/sites', {})).rejects.toThrow(/^invalid_field_type$/)
    await expect(shop.del('/sites/missing')).rejects.toThrow(/^not_found$/)
  })

  it('returns the parsed reply of a successful call unchanged', async () => {
    const api = fakeApi()
    await expect(shopApiFrom(api).get('/preferences')).resolves.toEqual({ ok: 1 })
    await expect(shopApiFrom(api).del('/groups/g1')).resolves.toEqual({ deleted: true })
  })
})

describe('toCodeError', () => {
  it('uses http_<status> when the body has no code', () => {
    expect(() => toCodeError(refusal(502, '<html>bad gateway</html>'))).toThrow(/^http_502$/)
    expect(() => toCodeError(refusal(500, '{"error":"boom"}'))).toThrow(/^http_500$/)
  })

  it('uses http_<status> when the code is not a string or the body is JSON null', () => {
    expect(() => toCodeError(refusal(500, '{"error":"only prose","code":42}'))).toThrow(/^http_500$/)
    expect(() => toCodeError(refusal(404, 'null'))).toThrow(/^http_404$/)
  })

  it('never surfaces the untranslated error prose when a code is present', () => {
    const failure = (() => {
      try {
        toCodeError(refusal(429, '{"code":"quota_exceeded","error":"raw english"}'))
      } catch (e) {
        return e
      }
    })()
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('quota_exceeded')
  })

  it('rethrows anything that is not a refusal unchanged', () => {
    const offline = new TypeError('Failed to fetch')
    expect(() => toCodeError(offline)).toThrow(offline)
  })
})
