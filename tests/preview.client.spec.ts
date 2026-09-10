// @vitest-environment jsdom
/** Shared preview ownership, routing, and native-frame lifecycle. */
import { createElement, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import {
  createPreviewBridge, forwardPreview, installPreviewFrame, PREVIEW_MESSAGE,
  previewCommand, SharedPreview, type PreviewProps,
} from '../src/client/preview.tsx'

const S1 = 'session-1' as SessionId
const S2 = 'session-2' as SessionId
const address = 'dsh-resource://file/session/session-2/README.md'
const message = (source: Window | null, data: object, origin = window.location.origin) =>
  new MessageEvent('message', { source, origin, data: { type: PREVIEW_MESSAGE, ...data } })

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('shared preview', () => {
  it('keeps the same native iframe across Session switches, close, fullscreen and viewport changes', () => {
    const bridge = createPreviewBridge()
    bridge.selectSession(undefined)
    bridge.selectSession(S1)
    const syncPresentation = vi.fn()
    const props = {
      bridge, syncPresentation, width: 400, viewportWidth: 1280, canShow: true,
      t: (key: string) => key,
      usePreview: (selector: (value: ReturnType<typeof bridge.state.getSnapshot>) => unknown) =>
        useSyncExternalStore(bridge.state.subscribe, () => selector(bridge.state.getSnapshot())),
    } as unknown as PreviewProps
    const view = render(createElement(SharedPreview, props))
    const frame = view.container.querySelector('iframe')!
    const src = frame.src
    expect(view.container.querySelector('aside')!.hidden).toBe(true)
    act(() => { bridge.show({ action: 'show' }) })
    expect(syncPresentation).toHaveBeenLastCalledWith(true, false, true)
    window.history.replaceState({}, '', '/?unrelated=navigation')
    act(() => { bridge.selectSession(S2); bridge.selectSession(undefined) })
    expect(bridge.state.getSnapshot().sessionId).toBe(S1)
    fireEvent.click(view.getByRole('button', { name: 'preview.fullscreen' }))
    expect(syncPresentation).toHaveBeenLastCalledWith(true, true, true)
    fireEvent.click(view.getByRole('button', { name: 'preview.close' }))
    expect(frame.isConnected).toBe(true)
    act(() => { bridge.show({ action: 'show' }) })
    view.rerender(createElement(SharedPreview, { ...props, viewportWidth: 600 }))
    expect(syncPresentation).toHaveBeenLastCalledWith(true, true, false)
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(frame.src).toBe(src)
    view.unmount()
    expect(syncPresentation).toHaveBeenLastCalledWith(false, false, false)
  })

  it('queues opens from multiple mounted Sessions until the fixed preview is ready, rejecting foreign and stale frames', () => {
    const bridge = createPreviewBridge()
    const preview = document.createElement('iframe')
    const conversation = document.createElement('iframe')
    conversation.dataset.dockingLayoutSessionFrame = S2
    document.body.append(preview, conversation)
    bridge.bindFrame(preview.contentWindow)
    const post = vi.spyOn(preview.contentWindow!, 'postMessage')
    bridge.receive(message(conversation.contentWindow, { action: 'resource', address, options: { params: { line: 42 } } }))
    bridge.show({ action: 'tab', kind: 'guide' })
    expect(post).not.toHaveBeenCalled()
    bridge.receive(message(conversation.contentWindow, { action: 'ready' }))
    bridge.receive(message(preview.contentWindow, { action: 'ready' }, 'https://unrelated.example'))
    expect(post).not.toHaveBeenCalled()
    bridge.receive(message(preview.contentWindow, { action: 'ready' }))
    expect(post.mock.calls).toEqual([
      [{ type: PREVIEW_MESSAGE, action: 'resource', address, options: { params: { line: 42 } } }, window.location.origin],
      [{ type: PREVIEW_MESSAGE, action: 'tab', kind: 'guide' }, window.location.origin],
    ])
    bridge.receive(message(preview.contentWindow, { action: 'collapsed' }))
    expect(bridge.state.getSnapshot().expanded).toBe(false)
    bridge.receive(message(null, { action: 'show' }))
    bridge.receive(message(window, { action: 'show' }))
    const stale = conversation.contentWindow
    conversation.remove()
    bridge.receive(message(stale, { action: 'show' }))
    expect(bridge.state.getSnapshot().expanded).toBe(false)
    bridge.show({ action: 'show' })
    expect(post).toHaveBeenLastCalledWith({ type: PREVIEW_MESSAGE, action: 'show' }, window.location.origin)
  })

  it('rejects malformed resource and tab commands', () => {
    for (const data of [
      { action: 'resource', address: 'https://example.com' },
      { action: 'resource', address, options: [] },
      { action: 'tab', kind: '' },
      { action: 'tab', kind: 'guide', options: null },
      { action: 'ready' },
    ]) expect(previewCommand(message(window, data))).toBeUndefined()
  })

  it('forwards native links and expand controls, then restores their behavior on unload', () => {
    const resource = vi.fn()
    const tab = vi.fn()
    const sidebar = { openResource: resource, openTab: tab } as unknown as ISidebarRight
    const send = vi.fn()
    const restore = forwardPreview(sidebar, send)
    const button = document.createElement('button')
    button.dataset.sidebarRightExpand = ''
    const child = document.createElement('span')
    button.append(child)
    const nativeExpand = vi.fn()
    button.addEventListener('click', nativeExpand)
    document.body.append(button)
    child.click()
    sidebar.openResource(address, { params: { line: 7 } } as never)
    sidebar.openTab('guide')
    expect(send.mock.calls.map(call => call[0])).toEqual([
      { action: 'show' }, { action: 'resource', address, options: { params: { line: 7 } } },
      { action: 'tab', kind: 'guide' },
    ])
    expect(nativeExpand).not.toHaveBeenCalled()
    expect(resource).not.toHaveBeenCalled()
    restore()
    expect(sidebar.openResource).toBe(resource)
    expect(sidebar.openTab).toBe(tab)
    child.click()
    expect(nativeExpand).toHaveBeenCalledOnce()
  })

  it('seeds an empty native surface before readiness and reopens it after the last file is closed', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    let expanded = false
    const toggleExpanded = vi.fn(() => { expanded = !expanded })
    const unsubscribe = vi.fn()
    const ctx = {
      sessions: {
        list: { subscribe: () => unsubscribe, getSnapshot: () => ({ current: S1, byId: { [S1]: {} } }) },
      },
      sidebarRight: { active: () => expanded ? {} : undefined, isExpanded: () => expanded,
        toggleExpanded, openResource: vi.fn(), openTab: vi.fn() },
    } as unknown as Context
    const dispose = installPreviewFrame(ctx, S1)
    frames.shift()!(0)
    expect(post).not.toHaveBeenCalled()
    const panel = document.createElement('div')
    panel.dataset.sidebarRightPanel = 'fullscreen'
    panel.dataset.sidebarRightOpen = ''
    const toggle = document.createElement('button')
    toggle.dataset.sidebarRightToggle = ''
    toggle.addEventListener('click', toggleExpanded)
    document.body.append(panel, toggle)
    frames.shift()!(1)
    expect(toggleExpanded).toHaveBeenCalledOnce()
    expect(post).toHaveBeenLastCalledWith({ type: PREVIEW_MESSAGE, action: 'ready' }, window.location.origin)
    expanded = false
    panel.removeAttribute('data-sidebar-right-open')
    await Promise.resolve()
    expect(post).toHaveBeenLastCalledWith({ type: PREVIEW_MESSAGE, action: 'collapsed' }, window.location.origin)
    window.dispatchEvent(message(window.parent, { action: 'show' }))
    expect(expanded).toBe(true)
    window.dispatchEvent(message(window.parent, { action: 'resource', address }))
    expect(ctx.sidebarRight.openResource).toHaveBeenCalledWith(address, undefined)
    dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(document.body.hasAttribute('data-dsh-docking-preview')).toBe(false)
    window.dispatchEvent(message(window.parent, { action: 'resource', address }))
    expect(ctx.sidebarRight.openResource).toHaveBeenCalledOnce()
  })
})
