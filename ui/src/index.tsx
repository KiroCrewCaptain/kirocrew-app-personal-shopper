/**
 * The bundle's entry: AppHost lazy-imports this module and renders its default
 * export as the app's page.
 *
 * Subscribing to the host's language generation here is what repaints the page
 * on a language switch: `t` reads the active locale at call time, and this
 * component's re-render reaches every child.
 */

import { useLanguageGeneration } from '@kirocrew/app-sdk'
import PersonalShopperPage from './PersonalShopperPage'

export default function PersonalShopperApp() {
  useLanguageGeneration()
  return <PersonalShopperPage />
}
