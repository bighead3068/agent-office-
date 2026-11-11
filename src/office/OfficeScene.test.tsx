import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OfficeScene } from './OfficeScene'
import { makeAgent } from './testing/makeAgent'
import type { OfficeAgent } from './types'

const timing = {
  easterEggIdleWaitMs: 1000,
  easterEggFrequencyCapMs: 5000,
  easterEggDurationMs: 4000,
}

function buttons() {
  return screen.getAllByRole('button')
}

function withBrowserStorage() {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const spy = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(frame.contentWindow!.localStorage)
  return () => {
    spy.mockRestore()
    frame.remove()
  }
}

describe('OfficeScene', () => {
  it('exposes status cues, selection, and an accessible name', () => {
    const onSelect = vi.fn()
    render(
      <OfficeScene
        now={0}
        selectedId="nia"
        onSelect={onSelect}
        agents={[
          makeAgent({
            id: 'nia',
            name: 'Nia',
            role: 'Implementer',
            status: 'working',
            task: { title: 'Tighten the seat highlight' },
          }),
          makeAgent({ id: 'moss', name: 'Moss', role: 'Researcher', status: 'completed', task: { title: 'Ship the note' } }),
        ]}
      />,
    )

    const nia = screen.getByRole('button', { name: /Nia，Implementer，工作中，上次更新 yesterday morning/ })
    expect(nia.getAttribute('data-seat')).toBe('S1')
    expect(nia.getAttribute('data-monitor')).toBe('blue')
    expect(nia.getAttribute('data-bubble')).toBe('gear')
    expect(nia.getAttribute('data-pose')).toBe('typing')
    expect(nia.getAttribute('data-selected')).toBe('true')
    expect(nia.getAttribute('aria-pressed')).toBe('true')

    const moss = screen.getByRole('button', { name: /Moss，Researcher，已完成/ })
    expect(moss.getAttribute('data-seat')).toBe('S2')
    expect(moss.getAttribute('data-monitor')).toBe('green')
    expect(moss.getAttribute('data-bubble')).toBe('check')
    expect(moss.getAttribute('data-pose')).toBe('sit')
    expect(moss.getAttribute('data-document')).toBe('true')
    expect(moss.getAttribute('data-animate')).toBe('false')
    expect(screen.getByRole('region', { name: '座位概況' }).textContent).toContain('Tighten the seat highlight')
  })

  it('keeps an agent in the same seat when status and input order change', () => {
    const nia = makeAgent({ id: 'nia', name: 'Nia', status: 'working' })
    const moss = makeAgent({ id: 'moss', name: 'Moss', status: 'idle' })
    const { rerender } = render(<OfficeScene now={0} agents={[nia, moss]} />)
    rerender(
      <OfficeScene
        now={0}
        agents={[
          { ...moss, status: 'failed' },
          { ...nia, status: 'completed' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: /Nia/ }).getAttribute('data-seat')).toBe('S1')
    expect(screen.getByRole('button', { name: /Nia/ }).getAttribute('data-status')).toBe('completed')
    expect(screen.getByRole('button', { name: /Moss/ }).getAttribute('data-seat')).toBe('S2')
    expect(screen.queryAllByRole('button')).toHaveLength(2)
  })

  it('restores seat owners after an empty loading render and scopes them to the supplied key', () => {
    const restoreStorage = withBrowserStorage()
    const key = 'office-scene-persisted-test'
    const otherKey = 'office-scene-independent-test'
    const nia = makeAgent({ id: 'nia', name: 'Nia' })
    const moss = makeAgent({ id: 'moss', name: 'Moss' })
    try {
      const first = render(<OfficeScene now={0} seatStorageKey={key} agents={[nia, moss]} />)
      first.unmount()

      const restored = render(<OfficeScene now={0} seatStorageKey={key} agents={[]} />)
      restored.rerender(<OfficeScene now={0} seatStorageKey={key} agents={[moss, nia]} />)
      expect(screen.getByRole('button', { name: /Nia/ }).getAttribute('data-seat')).toBe('S1')
      expect(screen.getByRole('button', { name: /Moss/ }).getAttribute('data-seat')).toBe('S2')

      restored.rerender(<OfficeScene now={0} seatStorageKey={otherKey} agents={[moss, nia]} />)
      expect(screen.getByRole('button', { name: /Moss/ }).getAttribute('data-seat')).toBe('S1')
      expect(screen.getByRole('button', { name: /Nia/ }).getAttribute('data-seat')).toBe('S2')
    } finally {
      restoreStorage()
    }
  })

  it('ignores corrupt seat storage and duplicate owners', () => {
    const restoreStorage = withBrowserStorage()
    const key = 'office-scene-corrupt-test'
    const nia = makeAgent({ id: 'nia', name: 'Nia' })
    const moss = makeAgent({ id: 'moss', name: 'Moss' })
    try {
      window.localStorage.setItem(key, 'invalid JSON')
      const invalid = render(<OfficeScene now={0} seatStorageKey={key} agents={[nia, moss]} />)
      expect(screen.getByRole('button', { name: /Nia/ }).getAttribute('data-seat')).toBe('S1')
      invalid.unmount()

      window.localStorage.setItem(key, JSON.stringify({ S2: 'nia', S3: 'nia', S5: [] }))
      render(<OfficeScene now={0} seatStorageKey={key} agents={[nia, moss]} />)
      expect(screen.getByRole('button', { name: /Nia/ }).getAttribute('data-seat')).toBe('S2')
      expect(screen.getByRole('button', { name: /Moss/ }).getAttribute('data-seat')).toBe('S1')
    } finally {
      restoreStorage()
    }
  })

  it('uses the in-memory assignment when the browser denies access to seat storage', () => {
    const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError')
    })
    const nia = makeAgent({ id: 'nia', name: 'Nia' })
    const moss = makeAgent({ id: 'moss', name: 'Moss' })
    try {
      const props = { now: 0, seatStorageKey: 'office-scene-blocked-test' }
      const { rerender } = render(<OfficeScene {...props} agents={[nia, moss]} />)
      rerender(<OfficeScene {...props} agents={[moss, nia]} />)
      expect(screen.getByRole('button', { name: /Nia/ }).getAttribute('data-seat')).toBe('S1')
      expect(screen.getByRole('button', { name: /Moss/ }).getAttribute('data-seat')).toBe('S2')
    } finally {
      storage.mockRestore()
    }
  })

  it.each([
    ['away', '離席'],
    ['unseated', '尚未入座'],
  ] as const)('shows an empty, selectable chair for %s and preserves its recorded status', async (deskPresence, flag) => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const nia = makeAgent({ id: 'nia', name: 'Nia', status: 'working', deskPresence })
    render(<OfficeScene now={0} agents={[nia]} onSelect={onSelect} />)
    const seat = screen.getByRole('button', { name: new RegExp(`Nia.*工作中.*${flag}`) })
    expect(within(seat).getByText(flag)).toBeTruthy()
    expect(seat.getAttribute('data-desk-presence')).toBe(deskPresence)
    expect(seat.getAttribute('data-seat-occupied')).toBe('false')
    expect(seat.getAttribute('data-status')).toBe('working')
    expect(seat.getAttribute('data-animate')).toBe('false')
    await user.click(seat)
    expect(onSelect).toHaveBeenCalledWith('nia')
  })

  it.each(['task change', 'away', 'disconnect', 'reduced motion'] as const)(
    'immediately ends a playful break on %s',
    (reason) => {
      const sol = makeAgent({ id: 'sol', name: 'Sol', status: 'idle', task: { title: 'First task' } })
      const props = { playful: true, config: timing, reducedMotion: false }
      const { rerender } = render(<OfficeScene {...props} now={0} agents={[sol]} />)
      rerender(<OfficeScene {...props} now={4000} agents={[sol]} />)
      const seat = screen.getByRole('button', { name: /Sol.*明確閒置/ })
      expect(within(seat).getByText('偷懶中')).toBeTruthy()
      expect(seat.getAttribute('data-pose')).toBe('nap')
      expect(seat.getAttribute('data-status')).toBe('idle')
      expect(screen.getByRole('region', { name: '座位概況' }).querySelector('[data-count="idle"]')?.textContent)
        .toBe('明確閒置1')

      const updated: OfficeAgent = { ...sol }
      if (reason === 'task change') updated.task = { title: 'Next task' }
      if (reason === 'away') updated.deskPresence = 'away'
      if (reason === 'disconnect') updated.connected = false
      rerender(<OfficeScene {...props} reducedMotion={reason === 'reduced motion'} now={4000} agents={[updated]} />)
      expect(within(seat).queryByText('偷懶中')).toBeNull()
      expect(seat.getAttribute('data-egg')).toBe('')
    },
  )

  it('offers a stationary, keyboard-accessible cat summary in reduced-motion mode', async () => {
    const user = userEvent.setup()
    const props = {
      playful: true,
      reducedMotion: true,
      agents: [makeAgent({ id: 'nia', name: 'Nia', status: 'working' })],
    }
    const { rerender } = render(<OfficeScene {...props} now={0} />)
    const cat = screen.getByRole('button', { name: /貓咪主管/ })
    const initialPosition = cat.getAttribute('style')
    rerender(<OfficeScene {...props} now={8000} />)
    expect(cat.getAttribute('style')).toBe(initialPosition)
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(cat)
    await user.keyboard('{Enter}')
    expect(cat.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: '貓咪主管巡查報告' }).textContent).toContain('工作中 1')
    await user.keyboard('{Escape}')
    expect(cat.getAttribute('aria-expanded')).toBe('false')
  })

  it('patrols the floor in playful mode when motion is allowed', () => {
    const { rerender } = render(<OfficeScene playful now={0} agents={[]} />)
    const cat = screen.getByRole('button', { name: /貓咪主管/ })
    const initialPosition = cat.getAttribute('style')
    rerender(<OfficeScene playful now={8000} agents={[]} />)
    expect(cat.getAttribute('style')).not.toBe(initialPosition)
  })

  it('has an agent hide a playful break as the supervisor walks past', () => {
    const props = {
      playful: true,
      config: timing,
      agents: [makeAgent({ id: 'sol', name: 'Sol', status: 'idle' })],
    }
    const { rerender } = render(<OfficeScene {...props} now={0} />)
    rerender(<OfficeScene {...props} now={10_000} />)
    const seat = screen.getByRole('button', { name: /Sol.*明確閒置/ })
    expect(within(seat).getByText('偷懶中')).toBeTruthy()
    rerender(<OfficeScene {...props} now={12_400} />)
    expect(within(seat).getByText('假裝在忙')).toBeTruthy()
    expect(seat.getAttribute('data-pose')).toBe('breathe')
  })

  it('does not give a new agent a finished owner\'s desk', () => {
    const sol = makeAgent({ id: 'sol', name: 'Sol', status: 'completed' })
    const others = ['a', 'b', 'c', 'd'].map((id) => makeAgent({ id, status: 'working' }))
    const incoming = makeAgent({ id: 'incoming', name: 'Incoming', status: 'working' })
    const props = { playful: true, rotateSeats: true, config: timing }
    const { rerender } = render(<OfficeScene {...props} now={0} agents={[sol, ...others]} />)
    const seat = screen.getByRole('button', { name: /Sol/ }).getAttribute('data-seat')
    rerender(<OfficeScene {...props} now={1} agents={[sol, ...others, incoming]} />)
    expect(screen.getByRole('button', { name: /Sol/ }).getAttribute('data-seat')).toBe(seat)
    expect(screen.queryByRole('button', { name: /Incoming/ })).toBeNull()
  })

  it('renders stale as frozen last-known cues and offline as a dimmed, clickable desk', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const working = makeAgent({
      id: 'nia',
      name: 'Nia',
      role: 'Implementer',
      status: 'working',
      lastUpdatedAt: '2026-11-07T18:42:00.000Z',
    })
    const { rerender } = render(<OfficeScene now={280} onSelect={onSelect} agents={[working]} />)
    expect(screen.getByRole('button').getAttribute('data-frame')).toBe('1')

    rerender(
      <OfficeScene
        now={2800}
        onSelect={onSelect}
        agents={[
          { ...working, freshness: 'stale' },
          makeAgent({ id: 'ren', name: 'Ren', role: 'Tester', status: 'offline', connected: false }),
        ]}
      />,
    )

    const stale = screen.getByRole('button', { name: /Nia，Implementer，工作中，過期，上次更新 11\/08 02:42/ })
    expect(stale.getAttribute('data-frame')).toBe('1')
    expect(stale.getAttribute('data-animate')).toBe('false')
    expect(stale.getAttribute('data-desaturate')).toBe('true')
    expect(stale.getAttribute('data-monitor')).toBe('blue')
    expect(stale.getAttribute('data-bubble')).toBe('gear')
    expect(stale.getAttribute('data-egg')).toBe('')
    expect(within(stale).getByText(/過期・11\/08 02:42/)).toBeTruthy()

    const offline = screen.getByRole('button', { name: /Ren，Tester，明確離線/ })
    expect(offline.getAttribute('data-monitor')).toBe('off')
    expect(offline.getAttribute('data-plug')).toBe('true')
    expect(offline.getAttribute('data-dim')).toBe('true')
    expect(offline.getAttribute('data-animate')).toBe('false')
    expect(within(offline).getByText('離線')).toBeTruthy()
    expect(offline.hasAttribute('disabled')).toBe(false)
    await user.click(offline)
    expect(onSelect).toHaveBeenCalledWith('ren')
  })

  it('never plays an easter egg for completed or for connected-but-unknown', () => {
    const people: OfficeAgent[] = [
      makeAgent({ id: 'sol', name: 'Sol', status: 'completed' }),
      makeAgent({ id: 'kit', name: 'Kit', status: 'unknown', connected: true }),
    ]
    const { rerender } = render(<OfficeScene now={0} config={timing} agents={people} />)
    rerender(<OfficeScene now={100_000} config={timing} agents={people} />)
    const [completed, unknown] = buttons()
    expect(completed?.getAttribute('data-egg')).toBe('')
    expect(completed?.getAttribute('data-pose')).toBe('sit')
    expect(completed?.getAttribute('data-bubble')).toBe('check')
    expect(unknown?.getAttribute('data-egg')).toBe('')
    expect(unknown?.getAttribute('data-status')).toBe('unknown')
    expect(unknown?.getAttribute('data-bubble')).toBe('question')
    expect(unknown?.getAttribute('data-opacity')).toBe('0.55')
    expect(unknown?.getAttribute('data-animate')).toBe('false')
    expect(unknown?.getAttribute('data-connected')).toBe('true')
  })

  it('plays an egg only after idle, fresh, and connected have been observed', () => {
    const sol = makeAgent({ id: 'sol', name: 'Sol', role: 'Reviewer', status: 'idle' })
    const { rerender } = render(<OfficeScene now={0} config={timing} agents={[sol]} />)
    expect(screen.getByRole('button').getAttribute('data-egg')).toBe('')
    expect(screen.getByRole('button').getAttribute('data-pose')).toBe('breathe')

    rerender(<OfficeScene now={1000} config={timing} agents={[sol]} />)
    const playing = screen.getByRole('button')
    expect(playing.getAttribute('data-egg')).toBe('nap')
    expect(playing.getAttribute('data-pose')).toBe('nap')

    rerender(<OfficeScene now={1200} config={timing} agents={[{ ...sol, status: 'completed' }]} />)
    expect(screen.getByRole('button').getAttribute('data-egg')).toBe('')
    expect(screen.getByRole('button').getAttribute('data-pose')).toBe('sit')
  })

  it('blocks eggs and looping motion when reduced motion is requested', () => {
    const sol = makeAgent({ id: 'sol', name: 'Sol', status: 'idle' })
    const nia = makeAgent({ id: 'nia', name: 'Nia', status: 'working' })
    const { rerender } = render(
      <OfficeScene now={0} reducedMotion config={timing} agents={[sol, nia]} />,
    )
    rerender(<OfficeScene now={100_000} reducedMotion config={timing} agents={[sol, nia]} />)
    const idle = screen.getByRole('button', { name: /Sol/ })
    const working = screen.getByRole('button', { name: /Nia/ })
    expect(idle.getAttribute('data-egg')).toBe('')
    expect(idle.getAttribute('data-animate')).toBe('false')
    expect(idle.getAttribute('data-pose')).toBe('breathe')
    expect(idle.getAttribute('data-monitor')).toBe('dim')
    expect(working.getAttribute('data-animate')).toBe('false')
    expect(working.getAttribute('data-bubble')).toBe('gear')
    expect(working.getAttribute('data-monitor')).toBe('blue')
    expect(working.getAttribute('data-pose')).toBe('typing')
    expect(screen.getByRole('group', { name: '代理人辦公室' }).getAttribute('data-reduced-motion')).toBe('true')
  })

  it('follows the reduced-motion media query when no override is passed', () => {
    const original = window.matchMedia
    window.matchMedia = (query: string) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList

    try {
      render(
        <OfficeScene
          now={50_000}
          config={timing}
          agents={[makeAgent({ id: 'sol', name: 'Sol', status: 'idle' })]}
        />,
      )
      const idle = screen.getByRole('button')
      expect(idle.getAttribute('data-egg')).toBe('')
      expect(idle.getAttribute('data-animate')).toBe('false')
      expect(screen.getByRole('group', { name: '代理人辦公室' }).getAttribute('data-reduced-motion')).toBe(
        'true',
      )
    } finally {
      window.matchMedia = original
    }
  })

  it('selects seats from the keyboard in seat order and skips empty desks', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const people = [
      makeAgent({ id: 'nia', name: 'Nia', status: 'working' }),
      makeAgent({ id: 'moss', name: 'Moss', status: 'waiting' }),
      makeAgent({ id: 'sol', name: 'Sol', status: 'failed' }),
    ]
    const { rerender } = render(<OfficeScene now={0} agents={people} onSelect={onSelect} />)

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Nia/ }))
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('nia')

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Moss/ }))
    await user.keyboard(' ')
    expect(onSelect).toHaveBeenCalledWith('moss')

    rerender(<OfficeScene now={0} agents={[people[0]!, people[2]!]} onSelect={onSelect} />)
    const nia = screen.getByRole('button', { name: /Nia/ })
    nia.focus()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Sol/ }))
    expect(screen.getByRole('button', { name: /Sol/ }).getAttribute('data-seat')).toBe('S3')
    expect(document.querySelector('[data-seat="S2"]')?.tagName).toBe('DIV')
  })

  it('leaves empty desks out of the tab order and keeps the summary read-only', () => {
    render(<OfficeScene now={0} agents={[]} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.querySelectorAll('[data-seat]')).toHaveLength(5)

    render(
      <OfficeScene
        now={0}
        agents={['a', 'b', 'c', 'd', 'e', 'f'].map((id) => makeAgent({ id, name: id }))}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(5)
    const summary = screen.getAllByRole('region', { name: '座位概況' }).at(-1)
    expect(summary?.textContent).toContain('1 人沒有座位')
    expect(summary?.querySelector('button, a, input, select, textarea')).toBeNull()
    expect(summary?.textContent?.toLowerCase()).not.toContain('assign')
    expect(summary?.textContent?.toLowerCase()).not.toContain('nudge')
    expect(screen.getAllByRole('list', { name: '狀態圖例' }).at(-1)?.textContent).toContain('明確離線')
  })
})
