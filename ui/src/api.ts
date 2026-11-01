/**
 * Personal Shopper API client: the host's permission-scoped client
 * (`useAppApi()`), confined to the `permissions.api` paths in app.json.
 *
 * A refusal surfaces as an `Error` whose message is the backend's `code`
 * (`invalid_field_type`, `owner_only`, ...), or `http_<status>` when the body
 * carries none. The backend's `error` prose is untranslated English meant for
 * logs; the code is the contract the UI can localize (RFC 9457 3.1.3), so the
 * prose is never shown.
 */

import { useMemo } from 'react'
import { useAppApi, type AppApi } from '@kirocrew/app-sdk'

export const BASE = '/api/apps/personal-shopper'

export interface ShopApi {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body: unknown): Promise<T>
  put<T>(path: string, body: unknown): Promise<T>
  del<T>(path: string): Promise<T>
}

function isApiError(e: unknown): e is { status: number; body: string } {
  return (
    typeof e === 'object' && e !== null &&
    typeof (e as { status?: unknown }).status === 'number' &&
    typeof (e as { body?: unknown }).body === 'string'
  )
}

/** The machine-readable code of a refused request, as an `Error`. Anything else is rethrown. */
export function toCodeError(e: unknown): never {
  if (!isApiError(e)) throw e
  let code = `http_${e.status}`
  try {
    const parsed: unknown = JSON.parse(e.body)
    if (parsed && typeof parsed === 'object' && typeof (parsed as { code?: unknown }).code === 'string') {
      code = (parsed as { code: string }).code
    }
  } catch { /* non-JSON */ }
  throw new Error(code)
}

export function shopApiFrom(api: AppApi): ShopApi {
  const run = <T,>(call: Promise<T>): Promise<T> => call.catch(toCodeError)
  return {
    get: (path) => run(api.get(`${BASE}${path}`)),
    post: (path, body) => run(api.post(`${BASE}${path}`, body)),
    put: (path, body) => run(api.put(`${BASE}${path}`, body)),
    del: (path) => run(api.del(`${BASE}${path}`)),
  }
}

export function useShopApi(): ShopApi {
  const api = useAppApi()
  return useMemo(() => shopApiFrom(api), [api])
}
