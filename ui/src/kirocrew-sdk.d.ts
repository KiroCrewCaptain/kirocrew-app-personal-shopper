/**
 * Types for the two host modules this bundle imports. They are not on npm: the
 * dashboard's import map serves them at runtime (`/vendor/*.mjs`), so only the
 * names this app uses are declared, with the shapes the App Kit documents.
 *
 * A name a host added at App Kit level 1 is typed `| undefined` here. That keeps
 * every use of it behind the feature check in `hostSdk.ts`: an older host's
 * module has no such export, and a NAMED import of a missing export fails the
 * whole bundle at link time, so those names are read off a namespace import.
 */

declare module '@kirocrew/app-sdk' {
  export interface AppApi {
    request<T = unknown>(path: string, init?: RequestInit): Promise<T>
    get<T = unknown>(path: string, init?: RequestInit): Promise<T>
    post<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T>
    put<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T>
    del<T = unknown>(path: string, init?: RequestInit): Promise<T>
  }

  /** A scoped non-2xx: `body` is the raw response text. */
  export interface AppApiError extends Error {
    readonly status: number
    readonly body: string
  }

  export interface ChatLaunchOptions {
    agent?: string
    message?: string
    slotKey?: string
    autoSend?: boolean
    /** Level 1. An older host ignores it and opens a plain new chat. */
    memoryMode?: 'persistent' | 'incognito' | 'temporary'
    /** Level 1. An older host ignores it. */
    sessionFolder?: false
  }

  export interface ImeGuard {
    /** Spread onto an input: Enter calls `onEnter` unless an IME composition owns the key. */
    bindEnter(opts: { onEnter?: () => void; onEscape?: () => void }): Pick<
      import('react').InputHTMLAttributes<HTMLInputElement>,
      'onKeyDown' | 'onCompositionStart' | 'onCompositionEnd' | 'onFocus' | 'onBlur'
    >
  }

  export type NumberOptions = Omit<Intl.NumberFormatOptions, 'localeMatcher'>

  export function useAppApi(): AppApi
  export function useChatLauncher(): { openChat: (opts?: ChatLaunchOptions) => void }
  export function useImeGuard(): ImeGuard
  export function useLanguageGeneration(): number
  export function activeLocale(): string
  export function fmtNumber(value: number, options?: NumberOptions): string

  // Level 1 (read through hostSdk.ts only).
  export const fmtCurrency:
    | ((value: number, currency?: string, options?: NumberOptions) => string)
    | undefined
  export const APP_SDK_LEVEL: number | undefined
}

declare module '@kirocrew/app-sdk/ui' {
  import type {
    ButtonHTMLAttributes,
    ComponentType,
    ForwardRefExoticComponent,
    InputHTMLAttributes,
    ReactNode,
    RefAttributes,
  } from 'react'

  export const Btn: ForwardRefExoticComponent<
    ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; primary?: boolean } & RefAttributes<HTMLButtonElement>
  >
  export const Input: ForwardRefExoticComponent<
    InputHTMLAttributes<HTMLInputElement> & RefAttributes<HTMLInputElement>
  >
  export const EmptyState: ComponentType<{
    icon: ReactNode
    title: string
    subtitle?: string
    action?: ReactNode
  }>
  export const PageHeader: ComponentType<{ title: ReactNode; subtitle?: string; actions?: ReactNode }>

  export interface Segment<T extends string = string> {
    key: T
    label: string
  }
  export function SegmentedControl<T extends string = string>(props: {
    segments: Segment<T>[]
    value: T
    onChange: (value: T) => void
    ariaLabel?: string
  }): ReactNode

  export const ErrorNotice: ComponentType<{
    message?: string | null
    className?: string
    /** Offer the "ask the agent" hand-off (only where no typed text is unsaved). */
    askAgent?: boolean
  }>

  export interface SelectProps {
    options: string[]
    optionLabels?: string[]
    value: string
    onChange: (value: string) => void
    clearLabel?: string
    disabled?: boolean
    'aria-label'?: string
    title?: string
    className?: string
  }

  // Level 1 (read through hostSdk.ts only).
  export const Select: ComponentType<SelectProps> | undefined
  export const guideCaution: Readonly<Record<string, string>> | undefined
}
