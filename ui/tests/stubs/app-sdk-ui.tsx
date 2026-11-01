/**
 * A light stand-in for the host's `@kirocrew/app-sdk/ui`, at App Kit level 1:
 * plain elements with the roles and labels the host components render, so a
 * test can find them the way a user would.
 */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import type { SelectProps } from '@kirocrew/app-sdk/ui'

export const Btn = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; primary?: boolean }
>(function Btn({ danger: _danger, primary: _primary, ...rest }, ref) {
  return <button ref={ref} {...rest} />
})

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} />
  },
)

export function EmptyState({ title, subtitle }: { icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <div>
      <div>{title}</div>
      {subtitle ? <div>{subtitle}</div> : null}
    </div>
  )
}

export function PageHeader({ title, subtitle }: { title: ReactNode; subtitle?: string }) {
  return (
    <header>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  )
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: { key: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="tablist">
      {segments.map((s) => (
        <button key={s.key} role="tab" aria-selected={s.key === value} onClick={() => onChange(s.key)}>
          {s.label}
        </button>
      ))}
    </div>
  )
}

export function ErrorNotice({ message }: { message?: string | null; askAgent?: boolean; className?: string }) {
  return message ? <div role="alert">{message}</div> : null
}

/** Stands in for the host's themed dropdown; marked so a test can tell it from the fallback. */
export function Select({ options, optionLabels, value, onChange, clearLabel, 'aria-label': ariaLabel }: SelectProps) {
  return (
    <select data-host-select="" aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {clearLabel !== undefined ? <option value="">{clearLabel}</option> : null}
      {options.map((o, i) => (
        <option key={o} value={o}>
          {optionLabels?.[i] ?? o}
        </option>
      ))}
    </select>
  )
}

export const guideCaution = { 'data-guide-caution': '' } as const
