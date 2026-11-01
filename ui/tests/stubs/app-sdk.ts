/**
 * A light stand-in for the host's `@kirocrew/app-sdk`, at App Kit level 1.
 *
 * Only the names the bundle uses, with the host's documented behaviour where a
 * test depends on it. The `stub*` / `resetStubSdk` exports are test controls; no
 * host module has them. A test that needs an older host replaces this module
 * with `vi.mock`.
 */

import { vi } from 'vitest'
import type { KeyboardEvent } from 'react'
import type { AppApi, ChatLaunchOptions, NumberOptions } from '@kirocrew/app-sdk'

let locale = 'en'

/** The host's active language for the next lookups. */
export function stubLocale(next: string): void {
  locale = next
}

export const stubOpenChat = vi.fn<(opts?: ChatLaunchOptions) => void>()

export function resetStubSdk(): void {
  locale = 'en'
  stubOpenChat.mockReset()
}

export function activeLocale(): string {
  return locale
}

export function useLanguageGeneration(): number {
  return 0
}

export function fmtNumber(value: number, options?: NumberOptions): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(locale, options).format(value)
}

export function fmtCurrency(value: number, currency = 'USD', options?: NumberOptions): string {
  if (!Number.isFinite(value)) return '—'
  return fmtNumber(value, { style: 'currency', currency, ...options })
}

export const APP_SDK_LEVEL = 1

const unstubbed = () => Promise.reject(new Error('stub app-sdk: no API in this test'))

export function useAppApi(): AppApi {
  return { request: unstubbed, get: unstubbed, post: unstubbed, put: unstubbed, del: unstubbed }
}

export function useChatLauncher(): { openChat: (opts?: ChatLaunchOptions) => void } {
  return { openChat: stubOpenChat }
}

export function useImeGuard() {
  return {
    bindEnter: ({ onEnter }: { onEnter?: () => void; onEscape?: () => void }) => ({
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onEnter?.()
        }
      },
    }),
  }
}
