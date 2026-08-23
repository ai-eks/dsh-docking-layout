// @vitest-environment jsdom
/** Docking Layout grouping, lifecycle, and drag-target semantics. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement, useSyncExternalStore } from 'react'
import type {
  SessionId, SessionListState, WorkspaceId, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import { apply as nodeApply } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { apply, inject } from '../src/client/index.ts'
import { DockingLayout, DockingLayoutFooterAction } from '../src/client/DockingLayout.tsx'
import {
  FRAME_NAVIGATE_MESSAGE, FRAME_READY_MESSAGE, FRAME_TOGGLE_SIDEBAR_MESSAGE,
  followFrameSession, frameSessionId, installFramePresentation,
} from '../src/client/frame.ts'
import {
  collectGroups, moveTab, reconcileSessionLayout, resolveDropZone, splitTab,
} from '../src/client/layout.ts'
import { zh } from '../src/client/locales.ts'
import { createDockingLayoutStore } from '../src/client/stores.ts'

const sid = (value: string): SessionId => value as SessionId
const S1 = sid('session-1')
const S2 = sid('session-2')
const S3 = sid('session-3')
const S4 = sid('session-4')
const S5 = sid('session-5')
const wid = (value: string): WorkspaceId => value as WorkspaceId

function bindSnapshotSelector<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  return selector => useSyncExternalStore(
    source.subscribe.bind(source),
    () => selector(source.getSnapshot()),
  )
}

function makeTranslate(dict: Readonly<Record<string, string>>) {
  return (key: string, params?: Readonly<Record<string, unknown>>): string => {
    const template = dict[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

const sessions: SessionListState = {
  ids: [S1, S2, S3],
  byId: {
    [S1]: { id: S1, displayTitle: 'Alpha', running: false, blank: false, updatedAt: 3 },
    [S2]: { id: S2, displayTitle: 'Beta', running: false, blank: false, updatedAt: 2 },
    [S3]: { id: S3, displayTitle: 'Gamma', running: true, blank: false, updatedAt: 1 },
  },
  current: S2,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
}

const workspaces: WorkspaceListState = {
  items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  baselinesReady: true, recentWorkspaceId: undefined,
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  const surface = document.createElement('main')
  const anchor = document.createElement('div')
  anchor.dataset.slot = 'conversation'
  surface.append(anchor)
  surface.getBoundingClientRect = () => ({
    x: 48, y: 0, left: 48, top: 0, right: 948, bottom: 700,
    width: 900, height: 700, toJSON: () => ({}),
  })
  document.body.append(surface)
})
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.head.querySelectorAll('[data-dsh-docking-frame-style]').forEach(node => { node.remove() })
  window.history.replaceState({}, '', '/')
})

describe('editor-group operations', () => {
  it('opens live Sessions as tabs and moves the global current tab owner', () => {
    const initial = reconcileSessionLayout(undefined, [S1, S2, S3], S2, undefined, 1)
    expect(initial.activeGroupId).toBe('group-1')
    expect(initial.nextGroup).toBe(2)
    expect(collectGroups(initial.layout)).toEqual([{
      kind: 'group', id: 'group-1', tabs: [S1, S2], active: S2,
    }])

    const currentMoved = reconcileSessionLayout(
      initial.layout, [S1, S2, S3], S3, initial.activeGroupId, initial.nextGroup,
    )
    expect(collectGroups(currentMoved.layout)[0]).toEqual({
      kind: 'group', id: 'group-1', tabs: [S1, S2, S3], active: S3,
    })
  })

  it('splits a tab to an edge and moves another tab into the target group center', () => {
    const opened = reconcileSessionLayout(undefined, [S1, S2, S3], S3, undefined, 1)
    const initial = reconcileSessionLayout(
      opened.layout, [S1, S2, S3], S2, opened.activeGroupId, opened.nextGroup,
    )
    const split = splitTab(initial.layout!, 'group-1', S2, 'right', initial.nextGroup)
    expect(split.layout?.kind).toBe('split')
    expect(split.layout?.kind === 'split' ? split.layout.axis : undefined).toBe('horizontal')
    expect(collectGroups(split.layout).map(group => group.tabs)).toEqual([[S1, S3], [S2]])

    const moved = moveTab(split.layout!, 'group-1', S3, 'group-2', 'center', split.nextGroup)
    expect(collectGroups(moved.layout).map(group => group.tabs)).toEqual([[S1], [S2, S3]])
    expect(collectGroups(moved.layout)[1]?.active).toBe(S3)
  })

  it('uses the nearest quarter-edge as a split drop target', () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 }
    expect(resolveDropZone(110, 200, rect)).toBe('left')
    expect(resolveDropZone(490, 200, rect)).toBe('right')
    expect(resolveDropZone(300, 60, rect)).toBe('top')
    expect(resolveDropZone(300, 340, rect)).toBe('bottom')
    expect(resolveDropZone(300, 200, rect)).toBe('center')
  })
})

describe('DockingLayout', () => {
  it('keeps same-origin Session frames mounted and splits by button', async () => {
    const instance = createDockingLayoutStore().create()
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(sessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    await waitFor(() => { expect(view.getAllByRole('article')).toHaveLength(1) })
    expect(document.body.hasAttribute('data-dsh-docking-layout-active')).toBe(true)
    expect(view.getAllByRole('article')).toHaveLength(1)
    expect(view.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
    expect(view.getByRole('tab', { name: /^Beta$/ }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByTitle('Alpha').getAttribute('src')).toContain('dsh-docking-session=session-1')
    expect(view.getByTitle('Beta').getAttribute('src')).toContain('dsh-docking-session=session-2')
    expect(view.queryByTitle('Gamma')).toBeNull()

    const alpha = view.getByRole('tab', { name: /^Alpha$/ })
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() }
    fireEvent.dragStart(alpha, { dataTransfer })
    expect(view.container.querySelector('[data-dragging]')).not.toBeNull()
    fireEvent.dragEnd(alpha)
    expect(view.container.querySelector('[data-dragging]')).toBeNull()

    fireEvent.click(alpha)
    expect(alpha.getAttribute('aria-selected')).toBe('true')

    fireEvent.click(view.getByRole('button', { name: '将当前标签拆分到右侧' }))
    expect(view.getAllByRole('article')).toHaveLength(2)
    expect(view.container.querySelectorAll('iframe')).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-docking-layout-top-right]')).toHaveLength(1)
    expect(
      view.container.querySelector('[data-docking-layout-top-right]')?.getAttribute('aria-label'),
    ).toBe('会话分组 2')

    expect(view.queryByRole('button', { name: '关闭分组' })).toBeNull()
    expect(view.queryByRole('button', { name: '返回单栏模式' })).toBeNull()
  })

  it('splits a persisted single tab by keeping an unopened Session in the source group', async () => {
    const instance = createDockingLayoutStore().create()
    const singleTabSessions = { ...sessions, current: S1 }
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1], active: S1,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => (
        selector(singleTabSessions)
      )) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    await waitFor(() => { expect(view.getAllByRole('article')).toHaveLength(1) })
    const split = view.getByRole<HTMLButtonElement>('button', { name: '将当前标签拆分到右侧' })
    expect(split.disabled).toBe(false)
    fireEvent.click(split)

    expect(view.getAllByRole('article')).toHaveLength(2)
    expect(view.getByRole('article', { name: '会话分组 1' }).textContent).toContain('Beta')
    expect(view.getByRole('article', { name: '会话分组 2' }).textContent).toContain('Alpha')
  })

  it('replaces the final tab with a blank New Session without leaving Docking Layout', async () => {
    const instance = createDockingLayoutStore().create()
    let sessionState: SessionListState = { ...sessions, current: S1 }
    const listeners = new Set<() => void>()
    const sessionSource: HostObservable<SessionListState> = {
      getSnapshot: () => sessionState,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const startSession = vi.fn(() => {
      sessionState = {
        ...sessionState,
        ids: [...sessionState.ids, S4],
        current: S4,
        byId: {
          ...sessionState.byId,
          [S4]: {
            id: S4, displayTitle: 'New Session', running: false, blank: true, updatedAt: 4,
          },
        },
      }
      for (const listener of listeners) listener()
    })
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1], active: S1,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: bindSnapshotSelector(sessionSource),
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession,
      t: makeTranslate(zh),
    }))

    const close = view.getByRole<HTMLButtonElement>('button', { name: '关闭标签: Alpha' })
    expect(close.disabled).toBe(false)
    fireEvent.click(close)

    await waitFor(() => {
      expect(view.getByRole('tab', { name: /^New Session$/ })).toBeTruthy()
    })
    expect(view.queryByRole('tab', { name: /^Alpha$/ })).toBeNull()
    expect(view.getByTitle('New Session').getAttribute('src')).toContain(
      'dsh-docking-session=session-4',
    )
    expect(instance.getSnapshot().enabled).toBe(true)
    expect(startSession).toHaveBeenCalledOnce()
  })

  it('keeps a newly selected blank Session inside Docking Layout', () => {
    const instance = createDockingLayoutStore().create()
    const blankSessions: SessionListState = {
      ...sessions,
      byId: {
        ...sessions.byId,
        [S2]: { ...sessions.byId[S2]!, blank: true },
      },
    }
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(blankSessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    expect(view.getByRole('article')).toBeTruthy()
    expect(view.getByRole('tab', { name: /^Beta$/ })).toBeTruthy()
    expect(view.getByTitle('Beta').getAttribute('src')).toContain(
      'dsh-docking-session=session-2',
    )
  })

  it('replaces a blank tab when its Workspace changes without opening history', async () => {
    const instance = createDockingLayoutStore().create()
    let sessionState: SessionListState = {
      ...sessions,
      current: S2,
      byId: {
        ...sessions.byId,
        [S2]: { ...sessions.byId[S2]!, blank: true },
      },
    }
    const listeners = new Set<() => void>()
    const sessionSource: HostObservable<SessionListState> = {
      getSnapshot: () => sessionState,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S2], active: S2,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: bindSnapshotSelector(sessionSource),
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    act(() => {
      sessionState = {
        ...sessionState,
        ids: [...sessionState.ids, S4],
        current: S4,
        byId: {
          ...sessionState.byId,
          [S4]: {
            id: S4, displayTitle: 'Workspace B', running: false, blank: true, updatedAt: 4,
          },
        },
      }
      for (const listener of listeners) listener()
    })

    await waitFor(() => {
      expect(view.getByRole('tab', { name: /^Workspace B$/ })).toBeTruthy()
    })
    expect(view.getAllByRole('tab')).toHaveLength(1)
    expect(view.queryByRole('tab', { name: /^Alpha$/ })).toBeNull()
    expect(view.queryByRole('tab', { name: /^Beta$/ })).toBeNull()
    expect(view.getByTitle('Workspace B').getAttribute('src')).toContain(
      'dsh-docking-session=session-4',
    )
  })

  it('toggles the layout only from the persistent sidebar footer', () => {
    const instance = createDockingLayoutStore().create()
    instance.actions.setEnabled(false)
    const view = render(createElement(DockingLayoutFooterAction, {
      wide: true,
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(sessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      t: makeTranslate(zh),
    }))

    expect(
      view.getByRole('button', { name: '打开停靠布局' })
        .querySelector('[data-docking-layout-docked-icon]'),
    ).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: '打开停靠布局' }))
    expect(instance.getSnapshot().enabled).toBe(true)
    expect(view.queryByRole('button', { name: '打开停靠布局' })).toBeNull()
    expect(
      view.getByRole('button', { name: '返回单栏模式' })
        .querySelector('[data-docking-layout-single-icon]'),
    ).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: '返回单栏模式' }))
    expect(instance.getSnapshot().enabled).toBe(false)
  })

  it('excludes archived Sessions from tabs and the open list', async () => {
    const instance = createDockingLayoutStore().create()
    const archivedWorkspaces: WorkspaceListState = {
      ...workspaces,
      archivedSessionIds: [S1],
    }
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(sessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(archivedWorkspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    await waitFor(() => { expect(view.queryByRole('tab', { name: /^Alpha$/ })).toBeNull() })
    expect(view.queryByTitle('Alpha')).toBeNull()
    expect(view.queryByRole('option', { name: 'Alpha' })).toBeNull()
    expect(view.getByRole('tab', { name: /^Gamma$/ })).toBeTruthy()
  })

  it('groups the open list by Workspace and matches sidebar visibility filtering', async () => {
    const instance = createDockingLayoutStore().create()
    const visibleSessions: SessionListState = {
      ...sessions,
      ids: [S1, S2, S3, S4, S5],
      current: S1,
      byId: {
        ...sessions.byId,
        [S4]: {
          id: S4, displayTitle: 'Child', running: false, blank: false, updatedAt: 4,
          origin: 'subagent', parentId: S1,
        },
        [S5]: { id: S5, displayTitle: 'Delta', running: false, blank: false, updatedAt: 5 },
      },
    }
    const groupedWorkspaces: WorkspaceListState = {
      ...workspaces,
      archivedSessionIds: [S2],
      items: [
        {
          workspaceId: wid('workspace-a'), path: '/a', title: 'Workspace A',
          sessionIds: [S1, S2, S4, S5], createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          workspaceId: wid('workspace-b'), path: '/b', title: 'Workspace B',
          sessionIds: [S3], createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    }
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1], active: S1,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => (
        selector(visibleSessions)
      )) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => (
        selector(groupedWorkspaces)
      )) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    await waitFor(() => { expect(view.getByRole('option', { name: 'Delta' })).toBeTruthy() })
    expect(view.getByRole('group', { name: 'Workspace A' }).textContent).toContain('Delta')
    expect(view.getByRole('group', { name: 'Workspace B' }).textContent).toContain('Gamma')
    expect(view.queryByRole('option', { name: 'Beta' })).toBeNull()
    expect(view.queryByRole('option', { name: 'Child' })).toBeNull()
  })
})

describe('plugin wiring', () => {
  it('registers only stock root slots and restores outer navigation after frame startup', () => {
    const open = vi.fn()
    const disposeLocale = vi.fn()
    const disposeLayout = vi.fn()
    const disposers: Array<() => void> = []
    const entries = new Map<string, { options: Record<string, unknown>; component: unknown }>()
    const ctx = {
      effect: (install: () => () => void) => { disposers.push(install()) },
      locale: { register: vi.fn(() => disposeLocale) },
      sessions: {
        list: { getSnapshot: () => sessions, subscribe: () => () => {} },
        open,
      },
      workspaces: { startSession: vi.fn() },
      layout: { toggleSidebar: vi.fn() },
      slots: {
        inject: vi.fn((_name: string, install: () => () => void) => {
          disposers.push(install())
        }),
        register: vi.fn((options: Record<string, unknown>, component: unknown) => {
          const name = options.name as string
          entries.set(name, { options, component })
          return name === 'shell.overlay' ? disposeLayout : vi.fn()
        }),
      },
    }

    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'locale', 'layout'])
    apply(ctx as never)
    const entry = entries.get('shell.overlay')
    expect(entry?.component).toBe(DockingLayout)
    expect(entry?.options.id).toBe('docking-layout')
    expect(entry?.options.locale).toBe('docking-layout')
    const injected = (entry?.options.inject as (() => { startSession: () => void }))()
    injected.startSession()
    expect(ctx.workspaces.startSession).toHaveBeenCalledOnce()
    const footer = entries.get('sidebar.footer.action')
    expect(footer?.component).toBe(DockingLayoutFooterAction)
    expect(footer?.options.store).toBe(entry?.options.store)
    expect(ctx.locale.register).toHaveBeenCalledWith('docking-layout', { zh, en: expect.any(Object) })

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: FRAME_READY_MESSAGE, sessionId: S1 },
    }))
    expect(open).toHaveBeenCalledWith(S2)

    open.mockClear()
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: FRAME_NAVIGATE_MESSAGE, sessionId: S1 },
    }))
    expect(open).toHaveBeenCalledWith(S1)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: FRAME_TOGGLE_SIDEBAR_MESSAGE },
    }))
    expect(ctx.layout.toggleSidebar).toHaveBeenCalledOnce()

    for (const dispose of disposers.reverse()) dispose()
    expect(disposeLayout).toHaveBeenCalledOnce()
    expect(disposeLocale).toHaveBeenCalledOnce()
  })

  it('locks an addressed embedded client and removes its duplicate shell chrome', () => {
    let state = sessions
    const listeners = new Set<() => void>()
    const open = vi.fn((id: SessionId) => {
      state = { ...state, current: id }
      for (const listener of listeners) listener()
    })
    const sessionService = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
      open,
    }

    const root = document.createElement('div')
    root.dataset.slot = 'root'
    const shell = document.createElement('div')
    const sidebarParent = document.createElement('aside')
    const sidebar = document.createElement('div')
    sidebar.dataset.slot = 'sidebar'
    sidebarParent.append(sidebar)
    const conversation = document.querySelector('[data-slot="conversation"]')!
    const conversationParent = conversation.parentElement!
    const detailsParent = document.createElement('aside')
    const details = document.createElement('div')
    details.dataset.slot = 'details'
    detailsParent.append(details)
    const mobileToggle = document.createElement('button')
    mobileToggle.dataset.mobileNav = 'toggle'
    conversation.append(mobileToggle)
    shell.append(sidebarParent, conversationParent, detailsParent)
    root.append(shell)
    document.body.append(root)

    expect(frameSessionId(`http://localhost/?dsh-docking-session=${S1}`, false)).toBeUndefined()
    expect(frameSessionId(`http://localhost/?dsh-docking-session=${S1}`, true)).toBe(S1)
    const postFrameMessage = vi.fn()
    const stopFollowing = followFrameSession(sessionService as never, S1, postFrameMessage)
    const removePresentation = installFramePresentation(postFrameMessage)
    expect(open).toHaveBeenCalledWith(S1)
    for (const listener of listeners) listener()
    expect(postFrameMessage).toHaveBeenCalledWith({
      type: FRAME_READY_MESSAGE,
      sessionId: S1,
    })

    state = { ...state, current: S2 }
    for (const listener of listeners) listener()
    expect(postFrameMessage).toHaveBeenCalledWith({
      type: FRAME_NAVIGATE_MESSAGE,
      sessionId: S2,
    })
    expect(open).toHaveBeenLastCalledWith(S1)
    expect(document.body.hasAttribute('data-dsh-docking-frame')).toBe(true)
    expect(shell.hasAttribute('data-dsh-docking-frame-shell')).toBe(true)
    expect(sidebarParent.hasAttribute('data-dsh-docking-frame-sidebar')).toBe(true)
    expect(conversationParent.hasAttribute('data-dsh-docking-frame-conversation')).toBe(true)
    expect(detailsParent.hasAttribute('data-dsh-docking-frame-details')).toBe(true)
    const frameStyle = document.head.querySelector<HTMLStyleElement>(
      '[data-dsh-docking-frame-style]',
    )
    expect(frameStyle?.textContent).toMatch(
      /\[data-dsh-docking-frame-conversation\][^{]*\{[^}]*grid-column:\s*2\s*!important;/,
    )
    expect(frameStyle?.textContent).toMatch(
      /\[data-dsh-docking-frame-conversation\][^{]*\{[^}]*grid-row:\s*1\s*!important;/,
    )
    expect(frameStyle?.textContent).not.toMatch(/button\[data-mobile-nav='toggle'\]/)
    expect(frameStyle?.textContent).not.toMatch(/display:\s*block\s*!important/)
    const messageCount = postFrameMessage.mock.calls.length
    expect(fireEvent.click(mobileToggle)).toBe(false)
    expect(postFrameMessage).toHaveBeenCalledWith({ type: FRAME_TOGGLE_SIDEBAR_MESSAGE })

    stopFollowing()
    removePresentation()
    fireEvent.click(mobileToggle)
    expect(postFrameMessage).toHaveBeenCalledTimes(messageCount + 1)
    expect(document.body.hasAttribute('data-dsh-docking-frame')).toBe(false)
    expect(shell.hasAttribute('data-dsh-docking-frame-shell')).toBe(false)
    expect(sidebarParent.hasAttribute('data-dsh-docking-frame-sidebar')).toBe(false)
    expect(conversationParent.hasAttribute('data-dsh-docking-frame-conversation')).toBe(false)
    expect(detailsParent.hasAttribute('data-dsh-docking-frame-details')).toBe(false)
  })

  it('keeps the Host half empty and registers its invariant companion', async () => {
    nodeApply()
    const register = vi.fn().mockReturnValue(() => {})
    const dispose = await invariant.apply({ invariants: { register } } as never)
    expect(register).toHaveBeenCalledWith(
      '@ai-eks/dsh-docking-layout', expect.any(Function),
    )
    expect(dispose).toBeTypeOf('function')
  })
})
