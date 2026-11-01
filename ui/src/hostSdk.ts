/**
 * Host names added at App Kit level 1, feature-detected.
 *
 * A named import of an export the host's module does not have fails the whole
 * bundle at link time, so a host older than these seams would show a broken page
 * instead of a slightly plainer one. These names are therefore read off namespace
 * imports, each through an `in` check (the explicit "does this module export it"
 * question), and each has a local fallback. Names every supported host has are
 * named-imported where they are used.
 */

import * as sdk from '@kirocrew/app-sdk'
import * as ui from '@kirocrew/app-sdk/ui'
import NativeSelect from './NativeSelect'

const hostFmtCurrency = 'fmtCurrency' in sdk ? sdk.fmtCurrency : undefined

/** Money in the active locale. An older host formats through `fmtNumber`. */
export function fmtCurrency(value: number, currency = 'USD'): string {
  if (typeof hostFmtCurrency === 'function') return hostFmtCurrency(value, currency)
  return sdk.fmtNumber(value, { style: 'currency', currency })
}

/** Spread onto a control that removes something; the guide shows its caution line there. */
export const caution: Readonly<Record<string, string>> =
  ('guideCaution' in ui ? ui.guideCaution : undefined) ?? {}

/** The host's inline dropdown, or a native `<select>` on a host without one. */
export const Select = ('Select' in ui ? ui.Select : undefined) ?? NativeSelect
