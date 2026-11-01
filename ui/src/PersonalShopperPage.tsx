/**
 * PersonalShopperPage — management panel for the Personal Shopper advisor.
 *
 * Three tabs: Preferences, History, Sites. Chat lives in the main chat
 * surface — the "Start conversation" button opens a new session pinned to
 * the personal-shopper-advisor agent through the host's chat launcher.
 */

import { useState, useCallback } from 'react'
import { MessageCirclePlus, ShoppingBag } from 'lucide-react'
import { useChatLauncher } from '@kirocrew/app-sdk'
import { Btn, ErrorNotice, PageHeader, SegmentedControl } from '@kirocrew/app-sdk/ui'
import { PreferencesTab } from './PreferencesTab'
import { HistoryTab } from './HistoryTab'
import { SitesTab } from './SitesTab'
import { t } from './i18n'

type Tab = 'preferences' | 'history' | 'sites'

const SEGMENTS: { key: Tab; labelKey: string }[] = [
  { key: 'preferences', labelKey: 'personalShopperPage.tab_preferences' },
  { key: 'history', labelKey: 'personalShopperPage.tab_history' },
  { key: 'sites', labelKey: 'personalShopperPage.tab_sites' },
]

export const ADVISOR_AGENT = 'personal-shopper-advisor'

/**
 * The advisor's session contract. App-owned workstreams choose their memory
 * contract explicitly, so a general chat preference must not silently alter
 * their behaviour: persistent memory, and no per-chat session folder. Both are
 * honoured only for a NEW session (no `slotKey`), which is what this opens. A
 * host older than App Kit level 1 ignores them and opens a plain new chat with
 * the agent selected.
 */
export const ADVISOR_LAUNCH = {
  agent: ADVISOR_AGENT,
  memoryMode: 'persistent',
  sessionFolder: false,
} as const

export default function PersonalShopperPage() {
  const [activeTab, setActiveTab] = useState<Tab>('preferences')
  const [createError, setCreateError] = useState<string | null>(null)
  const { openChat } = useChatLauncher()

  const startAdvisorSession = useCallback(() => {
    setCreateError(null)
    try {
      openChat(ADVISOR_LAUNCH)
    } catch (e) {
      // The launcher hands off to the chat page, which owns creating the session
      // and reports its own failures there. A throw here is the hand-off itself
      // failing, so it is shown rather than leaving a button that did nothing.
      setCreateError((e instanceof Error && e.message) || t('common.something_went_wrong'))
    }
  }, [openChat])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t('personalShopperPage.personal_shopper')}
        subtitle={t('personalShopperPage.your_life_problem_advisor_solves_first_shops_sec')}
      />

      {/* Hero CTA — prominent start-conversation area */}
      <div className="mx-4 mb-4 p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center flex-shrink-0">
          <ShoppingBag size={20} className="text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">
            {t('personalShopperPage.start_a_conversation_with_your_personal_advisor')}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {t('personalShopperPage.say_something_like_help_me_find_running_shoes_or')}
          </p>
          {/* The hand-off is offered only on the History tab: the Preferences and
              Sites tabs mount forms whose typed text is unsaved. */}
          <ErrorNotice
            className="mt-1"
            message={
              createError
                ? t('personalShopperPage.start_conversation_failed', { code: createError })
                : null
            }
            askAgent={activeTab === 'history'}
          />
        </div>
        <Btn onClick={startAdvisorSession} primary>
          <MessageCirclePlus size={14} />
          {t('personalShopperPage.start_advisor_conversation')}
        </Btn>
      </div>

      <div className="px-4 pb-2">
        <SegmentedControl
          value={activeTab}
          onChange={(v) => setActiveTab(v as Tab)}
          segments={SEGMENTS.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === 'preferences' && <PreferencesTab />}
        {activeTab === 'history' && <HistoryTab />}
        {activeTab === 'sites' && <SitesTab />}
      </div>
    </div>
  )
}
