// @vitest-environment jsdom
/** Docking Layout grouping, lifecycle, and drag-target semantics. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement, useSyncExternalStore } from 'react'
import type {
  SessionId, SessionListState, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import { apply as nodeApply } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { apply, inject } from '../src/client/index.ts'
import { DockingLayout, DockingLayoutFooterAction } from '../src/client/DockingLayout.tsx'
import {
  FRAME_READY_MESSAGE, followFrameSession, frameSessionId, installFramePresentation,
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
  it('keeps same-origin Session frames mounted, splits by button, and exits cleanly', async () => {
    const instance = createDockingLayoutStore().create()
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(sessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      t: makeTranslate(zh),
    }))

    await waitFor(() => { expect(view.getAllByRole('article')).toHaveLength(1) })
    expect(view.getAllByRole('article')).toHaveLength(1)
    expect(view.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
    expect(view.getByRole('tab', { name: /^Beta$/ }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByTitle('Alpha').getAttribute('src')).toContain('dsh-docking-session=session-1')
    expect(view.getByTitle('Beta').getAttribute('src')).toContain('dsh-docking-session=session-2')
    expect(view.queryByTitle('Gamma')).toBeNull()

    fireEvent.click(view.getByRole('tab', { name: /^Alpha$/ }))
    expect(view.getByRole('tab', { name: /^Alpha$/ }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(view.getByRole('button', { name: '将当前标签拆分到右侧' }))
    expect(view.getAllByRole('article')).toHaveLength(2)
    expect(view.container.querySelectorAll('iframe')).toHaveLength(2)

    fireEvent.click(view.getAllByRole('button', { name: '返回单栏模式' })[0]!)
    expect(view.queryByRole('article')).toBeNull()
    expect(instance.getSnapshot().enabled).toBe(false)
  })

  it('leaves a newly selected blank Session on the unobstructed native surface', () => {
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
      t: makeTranslate(zh),
    }))

    expect(view.container.innerHTML).toBe('')
    expect(view.queryByRole('article')).toBeNull()
  })

  it('puts the disabled-layout action in the persistent sidebar footer', () => {
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

    fireEvent.click(view.getByRole('button', { name: '打开停靠布局' }))
    expect(instance.getSnapshot().enabled).toBe(true)
    expect(view.queryByRole('button', { name: '打开停靠布局' })).toBeNull()
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
      t: makeTranslate(zh),
    }))

    await waitFor(() => { expect(view.queryByRole('tab', { name: /^Alpha$/ })).toBeNull() })
    expect(view.queryByTitle('Alpha')).toBeNull()
    expect(view.queryByRole('option', { name: 'Alpha' })).toBeNull()
    expect(view.getByRole('tab', { name: /^Gamma$/ })).toBeTruthy()
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

    expect(inject).toEqual(['slots', 'sessions', 'locale'])
    apply(ctx as never)
    const entry = entries.get('shell.overlay')
    expect(entry?.component).toBe(DockingLayout)
    expect(entry?.options.id).toBe('docking-layout')
    expect(entry?.options.locale).toBe('docking-layout')
    const footer = entries.get('sidebar.footer.action')
    expect(footer?.component).toBe(DockingLayoutFooterAction)
    expect(footer?.options.store).toBe(entry?.options.store)
    expect(ctx.locale.register).toHaveBeenCalledWith('docking-layout', { zh, en: expect.any(Object) })

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: FRAME_READY_MESSAGE, sessionId: S1 },
    }))
    expect(open).toHaveBeenCalledWith(S2)

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

    expect(frameSessionId(`http://localhost/?dsh-docking-session=${S1}`, false)).toBeUndefined()
    expect(frameSessionId(`http://localhost/?dsh-docking-session=${S1}`, true)).toBe(S1)
    const stopFollowing = followFrameSession(sessionService as never, S1)
    const removePresentation = installFramePresentation()
    expect(open).toHaveBeenCalledWith(S1)
    expect(document.body.hasAttribute('data-dsh-docking-frame')).toBe(true)

    stopFollowing()
    removePresentation()
    expect(document.body.hasAttribute('data-dsh-docking-frame')).toBe(false)
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
