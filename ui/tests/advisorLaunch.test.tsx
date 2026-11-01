/**
 * The start button opens the advisor through the host's chat launcher with the
 * advisor's session contract: persistent memory and no per-chat session folder.
 * The built-in got this by creating the slot itself; a bundle must ask the
 * launcher, and a launch without these two options would silently take the
 * owner's general chat defaults instead.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import PersonalShopperPage, { ADVISOR_LAUNCH } from '../src/PersonalShopperPage'
import { stubOpenChat } from './stubs/app-sdk'
import { renderWithProviders } from './helpers'

vi.mock('../src/api', () => ({
  useShopApi: () => ({
    get: () => new Promise(() => {}),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  }),
}))

const startButton = () => screen.getByRole('button', { name: 'Start advisor conversation' })

describe('starting an advisor conversation', () => {
  it('opens a new session for the advisor with persistent memory and no session folder', () => {
    renderWithProviders(<PersonalShopperPage />)
    fireEvent.click(startButton())
    expect(stubOpenChat).toHaveBeenCalledTimes(1)
    expect(stubOpenChat).toHaveBeenCalledWith({
      agent: 'personal-shopper-advisor',
      memoryMode: 'persistent',
      sessionFolder: false,
    })
  })

  it('never targets an existing session or auto-sends a message', () => {
    // Both options are honoured only for a NEW session; a slotKey would drop them.
    expect(ADVISOR_LAUNCH).not.toHaveProperty('slotKey')
    expect(ADVISOR_LAUNCH).not.toHaveProperty('message')
  })

  it('shows the failure when the hand-off itself throws', () => {
    stubOpenChat.mockImplementation(() => {
      throw new Error('launcher_unavailable')
    })
    renderWithProviders(<PersonalShopperPage />)
    fireEvent.click(startButton())
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't start the conversation (launcher_unavailable)",
    )
  })

  it('falls back to the localized generic message when the throw has none', () => {
    stubOpenChat.mockImplementation(() => {
      throw new Error('')
    })
    renderWithProviders(<PersonalShopperPage />)
    fireEvent.click(startButton())
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't start the conversation (Something went wrong)",
    )
  })
})
