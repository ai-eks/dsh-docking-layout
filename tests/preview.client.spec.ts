// @vitest-environment jsdom
/** Shared preview ownership, routing, and native-frame lifecycle. */
import { createElement, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import {
  createPreviewBridge, forwardPreview, installPreviewFrame, PREVIEW_MESSAGE,
  previewCommand, PreviewToggle, SharedPreview, type PreviewProps,
} from '../src/client/preview.tsx'

const S1 = 'session-1' as SessionId
const S2 = 'session-2' as SessionId
const A = { workspaceId: 'a', path: '/a', title: 'Project A', sessionIds: [S1] } as WorkspaceView
const B = { workspaceId: 'b', path: '/b', title: 'Project B', sessionIds: [S2] } as WorkspaceView
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
      bridge, syncPresentation, connectWorkspace: vi.fn(),
      useWorkspaces: (selector: (value: unknown) => unknown) => selector({ items: [A, B] }),
      width: 400, viewportWidth: 1280, canShow: true,
      t: (key: string) => key,
      usePreview: (selector: (value: ReturnType<typeof bridge.state.getSnapshot>) => unknown) =>
        useSyncExternalStore(bridge.state.subscribe, () => selector(bridge.state.getSnapshot())),
    } as unknown as PreviewProps
    const view = render(createElement(SharedPreview, props))
    const toolbar = render(createElement(PreviewToggle, { bridge, t: props.t }))
    const frame = view.container.querySelector('iframe')!
    const src = frame.src
    expect(view.container.querySelector('aside')!.hidden).toBe(true)
    fireEvent.click(toolbar.getByRole('button', { name: 'preview.showSidebar' }))
    expect(syncPresentation).toHaveBeenLastCalledWith(true, false, true)
    expect(toolbar.getByRole('button', { name: 'preview.hideSidebar' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toolbar.getByRole('button', { name: 'preview.hideSidebar' }))
    expect(view.container.querySelector('aside')!.hidden).toBe(true)
    expect(frame.isConnected).toBe(true)
    fireEvent.click(toolbar.getByRole('button', { name: 'preview.showSidebar' }))
    window.history.replaceState({}, '', '/?unrelated=navigation')
    act(() => { bridge.selectSession(S2); bridge.selectSession(undefined) })
    expect(bridge.state.getSnapshot().sessionId).toBe(S1)
    fireEvent.click(view.getByRole('button', { name: 'preview.fullscreen' }))
    expect(syncPresentation).toHaveBeenLastCalledWith(true, true, true)
    fireEvent.click(view.getByRole('button', { name: 'preview.close' }))
    expect(toolbar.getByRole('button', { name: 'preview.showSidebar' }).getAttribute('aria-pressed')).toBe('false')
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
    bridge.selectSession(S1)
    bridge.bindFrame(S1, preview.contentWindow)
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

  it('manually switches workspace while retaining both native frames and routes only to the selected owner', async () => {
    const bridge = createPreviewBridge()
    bridge.selectSession(S1)
    const props = {
      bridge, syncPresentation: vi.fn(), connectWorkspace: vi.fn(), width: 400, viewportWidth: 1280, canShow: true,
      useWorkspaces: (selector: (value: unknown) => unknown) => selector({ items: [A, B] }),
      t: (key: string) => key,
      usePreview: (selector: (value: ReturnType<typeof bridge.state.getSnapshot>) => unknown) =>
        useSyncExternalStore(bridge.state.subscribe, () => selector(bridge.state.getSnapshot())),
    } as unknown as PreviewProps
    bridge.show({ action: 'show' })
    const view = render(createElement(SharedPreview, props))
    const a = view.container.querySelector('iframe')!
    const postA = vi.spyOn(a.contentWindow!, 'postMessage')
    act(() => { bridge.receive(message(a.contentWindow, { action: 'ready' })) })
    fireEvent.change(view.getByRole('combobox', { name: 'preview.workspace' }), { target: { value: B.workspaceId } })
    const b = view.container.querySelectorAll('iframe')[1]!
    const postB = vi.spyOn(b.contentWindow!, 'postMessage')
    expect(a.hidden).toBe(true)
    expect(b.hidden).toBe(false)
    act(() => {
      bridge.show({ action: 'tab', kind: 'terminal' })
      bridge.receive(message(a.contentWindow, { action: 'collapsed' }))
      bridge.selectSession(S1)
    })
    expect(bridge.state.getSnapshot().expanded).toBe(true)
    expect(bridge.state.getSnapshot().sessionId).toBe(S2)
    expect(postA).toHaveBeenCalledTimes(1)
    expect(postB).not.toHaveBeenCalled()
    act(() => { bridge.receive(message(b.contentWindow, { action: 'ready' })) })
    expect(postB.mock.calls.map(call => call[0].action)).toEqual(['show', 'tab'])
    fireEvent.change(view.getByRole('combobox', { name: 'preview.workspace' }), { target: { value: A.workspaceId } })
    expect(view.container.querySelectorAll('iframe')).toHaveLength(2)
    expect(view.container.querySelector('iframe')).toBe(a)
    expect(a.hidden).toBe(false)
    expect(b.hidden).toBe(true)
    expect(postA).toHaveBeenCalledTimes(2)
    expect(props.connectWorkspace).not.toHaveBeenCalled()
  })

  it('reuses the original owner even when it is not the workspace’s first Session', async () => {
    const bridge = createPreviewBridge()
    bridge.selectSession(S2)
    const workspace = { ...A, sessionIds: [S1, S2] }
    await bridge.chooseWorkspace(workspace, vi.fn())
    expect(bridge.state.getSnapshot().sessionIds).toEqual([S2])
    expect(bridge.state.getSnapshot().sessionId).toBe(S2)
  })

  it('connects an empty workspace before changing its owner', async () => {
    const bridge = createPreviewBridge()
    bridge.selectSession(S1)
    let resolve!: (id: SessionId) => void
    const connect = vi.fn(() => new Promise<SessionId>(done => { resolve = done }))
    const pending = bridge.chooseWorkspace({ ...B, sessionIds: [] }, connect)
    expect(connect).toHaveBeenCalledExactlyOnceWith(B.workspaceId)
    expect(bridge.state.getSnapshot()).toMatchObject({ sessionId: S1, pendingWorkspace: B.workspaceId })
    resolve(S2)
    await pending
    expect(bridge.state.getSnapshot()).toMatchObject({ sessionId: S2, sessionIds: [S1, S2], pendingWorkspace: undefined, expanded: true })
    bridge.selectSession(S1)
    expect(bridge.state.getSnapshot().sessionId).toBe(S2)
  })

  it('keeps the previous workspace on connection failure and ignores stale or disposed connection results', async () => {
    const bridge = createPreviewBridge()
    bridge.selectSession(S1)
    let resolve!: (id: SessionId) => void
    const connect = vi.fn(() => new Promise<SessionId>(done => { resolve = done }))
    const empty = { ...B, sessionIds: [] }
    const pending = bridge.chooseWorkspace(empty, connect)
    expect(bridge.state.getSnapshot()).toMatchObject({ sessionId: S1, pendingWorkspace: B.workspaceId })
    await bridge.chooseWorkspace(A, connect)
    resolve(S2)
    await pending
    expect(bridge.state.getSnapshot().sessionId).toBe(S1)
    await bridge.chooseWorkspace(empty, async () => { throw new Error('Connection failed') })
    expect(bridge.state.getSnapshot()).toMatchObject({ sessionId: S1, pendingWorkspace: undefined, error: 'Connection failed' })
    const disposed = bridge.chooseWorkspace(empty, connect)
    bridge.dispose()
    resolve(S2)
    await disposed
    expect(bridge.state.getSnapshot().sessionIds).toEqual([S1])
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
    const host = document.createElement('div')
    host.dataset.dshPanelHost = ''
    document.body.append(host)
    const dispose = installPreviewFrame(ctx, S1)
    expect(getComputedStyle(host).visibility).toBe('hidden')
    expect(getComputedStyle(host).display).not.toBe('none')
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
