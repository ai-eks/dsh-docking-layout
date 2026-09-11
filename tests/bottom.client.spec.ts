// @vitest-environment jsdom
/** Independent bottom ownership, native lifecycle, layout space, and optional activation. */
import { createElement, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { installBottomFrame, installBottomProxy, installSharedBottom, SharedBottom } from '../src/client/bottom.tsx'
import { BOTTOM_MESSAGE, PREVIEW_MESSAGE, createPreviewBridge, PreviewToggle } from '../src/client/preview.tsx'

const A = 'session-a' as SessionId
const B = 'session-b' as SessionId
const workspaces = [
  { workspaceId: 'a', path: '/a', title: 'Project A', sessionIds: [A] },
  { workspaceId: 'b', path: '/b', title: 'Project B', sessionIds: [B] },
]
const message = (source: Window | null, type: string, action: string) =>
  new MessageEvent('message', { source, origin: window.location.origin, data: { type, action } })

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.documentElement.style.removeProperty('--docking-bottom-height')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('shared bottom panel', () => {
  it('hides unavailable controls and keeps right and bottom commands independent', () => {
    const bottom = createPreviewBridge(BOTTOM_MESSAGE, false)
    bottom.selectSession(A)
    const view = render(createElement(PreviewToggle, { bridge: bottom, t: key => key, panel: 'bottom' }))
    expect(view.queryByRole('button')).toBeNull()
    act(() => { bottom.setAvailable(true) })
    fireEvent.click(view.getByRole('button', { name: 'bottom.showSidebar' }))
    const frame = document.createElement('iframe')
    document.body.append(frame)
    bottom.bindFrame(A, frame.contentWindow)
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    bottom.receive(message(frame.contentWindow, PREVIEW_MESSAGE, 'ready'))
    expect(post).not.toHaveBeenCalled()
    bottom.receive(message(frame.contentWindow, BOTTOM_MESSAGE, 'ready'))
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: BOTTOM_MESSAGE, action: 'show' }, window.location.origin)
    act(() => { bottom.setAvailable(false) })
    expect(view.queryByRole('button')).toBeNull()
    expect(bottom.state.getSnapshot().expanded).toBe(false)
  })

  it('reserves shared space, resizes by keyboard, and preserves workspace frames across conversation changes', () => {
    const column = document.createElement('main')
    column.innerHTML = '<div data-slot="main"></div>'
    document.body.append(column)
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ left: 240, top: 0, width: 700, height: 500 } as DOMRect)
    const bridge = createPreviewBridge(BOTTOM_MESSAGE)
    bridge.selectSession(A)
    bridge.show({ action: 'show' })
    const props = {
      bridge, syncPresentation: vi.fn(), connectWorkspace: vi.fn(), t: (key: string) => key,
      useWorkspaces: (selector: (value: unknown) => unknown) => selector({ items: workspaces }),
      usePreview: (selector: (value: ReturnType<typeof bridge.state.getSnapshot>) => unknown) =>
        useSyncExternalStore(bridge.state.subscribe, () => selector(bridge.state.getSnapshot())),
    } as unknown as Parameters<typeof SharedBottom>[0]
    const view = render(createElement(SharedBottom, props))
    const first = view.container.querySelector('iframe')!
    expect(first.src).toContain('dsh-docking-bottom=session-a')
    expect(first.src).not.toContain('dsh-docking-preview=')
    expect(document.documentElement.style.getPropertyValue('--docking-bottom-height')).toBe('280px')
    fireEvent.keyDown(view.getByRole('separator', { name: 'bottom.resize' }), { key: 'ArrowUp' })
    expect(document.documentElement.style.getPropertyValue('--docking-bottom-height')).toBe('300px')
    fireEvent.change(view.getByRole('combobox', { name: 'bottom.workspace' }), { target: { value: 'b' } })
    act(() => { bridge.selectSession(A) })
    expect(bridge.state.getSnapshot().sessionId).toBe(B)
    expect(first.isConnected).toBe(true)
    expect(first.hidden).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'bottom.close' }))
    expect(document.documentElement.style.getPropertyValue('--docking-bottom-height')).toBe('0px')
    expect(first.isConnected).toBe(true)
    act(() => { bridge.show({ action: 'show' }) })
    expect(document.documentElement.style.getPropertyValue('--docking-bottom-height')).toBe('300px')
    view.unmount()
    expect(document.documentElement.style.getPropertyValue('--docking-bottom-height')).toBe('0px')
  })

  it('replaces local bottom chrome and restores it when the integration is removed', () => {
    const toggle = document.createElement('button')
    toggle.dataset.dshBottomToggle = ''
    const panel = document.createElement('div')
    panel.dataset.dshPanelHost = ''
    const column = document.createElement('main')
    column.dataset.dshCenterCol = ''
    document.body.append(toggle, panel, column)
    const nativeToggle = vi.fn()
    toggle.addEventListener('click', nativeToggle)
    const show = vi.fn()
    const dispose = installBottomProxy(show)
    toggle.click()
    expect(show).toHaveBeenCalledOnce()
    expect(nativeToggle).not.toHaveBeenCalled()
    expect(getComputedStyle(toggle).display).toBe('none')
    expect(getComputedStyle(panel).visibility).toBe('hidden')
    expect(getComputedStyle(column).marginBottom).toBe('0px')
    dispose()
    toggle.click()
    expect(nativeToggle).toHaveBeenCalledOnce()
    expect(getComputedStyle(panel).visibility).not.toBe('hidden')
  })

  it.each([true, false])('opens with a header toggle present: %s, waits for its owner and forwards collapse', hasHeader => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    let snapshot = { sessionId: B as string, state: { bottomOpen: false } }
    let listener = () => {}
    const unsubscribe = vi.fn()
    const service = { getSnapshot: () => snapshot, subscribeState: (next: () => void) => { listener = next; return unsubscribe } }
    const ctx = {
      sessions: { list: { subscribe: () => vi.fn(), getSnapshot: () => ({ current: A, byId: { [A]: {} } }) } },
      sidebarRight: { openResource: vi.fn(), openTab: vi.fn() },
    } as unknown as Context
    const toggle = document.createElement('button')
    if (hasHeader) toggle.dataset.dshBottomToggle = ''
    toggle.addEventListener('click', () => { snapshot = { ...snapshot, state: { bottomOpen: !snapshot.state.bottomOpen } }; listener() })
    const panel = document.createElement('div')
    panel.dataset.dshBottomPanel = ''
    panel.append(toggle)
    document.body.append(panel)
    const dispose = installBottomFrame(ctx, service, A)
    frames.shift()!(0)
    expect(post).not.toHaveBeenCalled()
    snapshot = { sessionId: A, state: { bottomOpen: false } }
    listener()
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: BOTTOM_MESSAGE, action: 'ready' }, window.location.origin)
    window.dispatchEvent(message(null, BOTTOM_MESSAGE, 'show'))
    window.dispatchEvent(message(window.parent, PREVIEW_MESSAGE, 'show'))
    expect(snapshot.state.bottomOpen).toBe(false)
    window.dispatchEvent(message(window.parent, BOTTOM_MESSAGE, 'show'))
    expect(snapshot.state.bottomOpen).toBe(true)
    toggle.click()
    expect(post).toHaveBeenLastCalledWith({ type: BOTTOM_MESSAGE, action: 'collapsed' }, window.location.origin)
    dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    window.dispatchEvent(message(window.parent, BOTTOM_MESSAGE, 'show'))
    expect(snapshot.state.bottomOpen).toBe(false)
    expect(document.body.hasAttribute('data-dsh-docking-bottom-client')).toBe(false)
  })

  it('keeps the bottom panel unavailable until the companion service is installed', () => {
    const disposers: Array<() => void> = []
    const inject = vi.fn()
    const ctx = { inject, effect: (run: () => () => void) => disposers.push(run()),
      sessions: { list: { getSnapshot: () => ({ current: A }), subscribe: () => vi.fn() } },
    } as unknown as Context
    const bridge = installSharedBottom(ctx)
    expect(bridge.state.getSnapshot()).toMatchObject({ available: false, sessionId: A, expanded: false })
    expect(inject).toHaveBeenCalledWith(['betterSidebar'], expect.any(Function))
    disposers.reverse().forEach(dispose => dispose())
  })
})
