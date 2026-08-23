// @vitest-environment jsdom
/** Docking Layout grouping, lifecycle, and drag-target semantics. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement, StrictMode, useSyncExternalStore } from 'react'
import type {
  SessionId, SessionListState, WorkspaceId, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import { apply as nodeApply } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import { styleModule } from '../tsdown.config.ts'
import { apply, inject } from '../src/client/index.ts'
import { DockingLayout, DockingLayoutFooterAction } from '../src/client/DockingLayout.tsx'
import {
  FRAME_FOCUS_MESSAGE, FRAME_NAVIGATE_MESSAGE, FRAME_READY_MESSAGE,
  FRAME_TOGGLE_SIDEBAR_MESSAGE,
  followFrameSession, frameSessionId, installFramePresentation,
} from '../src/client/frame.ts'
import {
  canSplitBounds, closeTab, collectGroups, collectSessionIds, moveTab, reconcileSessionLayout,
  resolveDropZone, splitTab, type SessionLayoutNode,
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

function mockBounds(element: Element, width: number, height: number): void {
  element.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height,
    width, height, toJSON: () => ({}),
  })
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
  document.head.querySelectorAll('[data-plugin-css]').forEach(node => { node.remove() })
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

  it('requires enough room in the requested split direction', () => {
    expect(canSplitBounds({ width: 640, height: 561 }, 'right')).toBe(false)
    expect(canSplitBounds({ width: 641, height: 560 }, 'right')).toBe(true)
    expect(canSplitBounds({ width: 641, height: 560 }, 'bottom')).toBe(false)
    expect(canSplitBounds({ width: 640, height: 561 }, 'bottom')).toBe(true)
    expect(canSplitBounds({ width: 641, height: 279 }, 'right')).toBe(false)
    expect(canSplitBounds({ width: 319, height: 561 }, 'bottom')).toBe(false)
    expect(canSplitBounds({ width: 0, height: 0 }, 'center')).toBe(true)
    expect(canSplitBounds({ width: 0, height: 0 }, 'right', true)).toBe(true)
  })

  it('allows an edge move to create a fifth group', () => {
    const atLimit: SessionLayoutNode = {
      kind: 'split',
      axis: 'horizontal',
      first: { kind: 'group', id: 'group-1', tabs: [S1, S2], active: S2 },
      second: {
        kind: 'split',
        axis: 'vertical',
        first: { kind: 'group', id: 'group-2', tabs: [S3], active: S3 },
        second: {
          kind: 'split',
          axis: 'horizontal',
          first: { kind: 'group', id: 'group-3', tabs: [S4], active: S4 },
          second: { kind: 'group', id: 'group-4', tabs: [S5], active: S5 },
        },
      },
    }

    const moved = moveTab(atLimit, 'group-1', S2, 'group-2', 'right', 5)

    expect(moved.layout).not.toBe(atLimit)
    expect(moved.activeGroupId).toBe('group-5')
    expect(moved.nextGroup).toBe(6)
    expect(collectGroups(moved.layout).map(group => group.tabs)).toEqual([
      [S1], [S3], [S2], [S4], [S5],
    ])
  })

  it('preserves the active group when a background singleton group closes', () => {
    const layout: SessionLayoutNode = {
      kind: 'split',
      axis: 'horizontal',
      first: { kind: 'group', id: 'group-1', tabs: [S1], active: S1 },
      second: {
        kind: 'split',
        axis: 'vertical',
        first: { kind: 'group', id: 'group-2', tabs: [S2], active: S2 },
        second: { kind: 'group', id: 'group-3', tabs: [S3], active: S3 },
      },
    }

    const result = closeTab(layout, 'group-3', S3, 'group-2', 4)

    expect(result.activeGroupId).toBe('group-2')
    expect(collectGroups(result.layout).map(group => group.tabs)).toEqual([[S1], [S2]])
  })
})

describe('DockingLayout', () => {
  it('tracks a replacement conversation surface without a window resize', async () => {
    const instance = createDockingLayoutStore().create()
    const initialSurface = document.querySelector('[data-slot="conversation"]')!.parentElement!
    const initialRect = initialSurface.getBoundingClientRect.bind(initialSurface)
    const measureInitial = vi.fn(initialRect)
    initialSurface.getBoundingClientRect = measureInitial
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(sessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))
    const root = view.container.querySelector<HTMLElement>('[data-docking-layout]')!
    await waitFor(() => { expect(root.style.left).toBe('48px') })

    const measurementCount = measureInitial.mock.calls.length
    await act(async () => {
      document.querySelector('[data-slot="conversation"]')!.append(document.createElement('p'))
      await new Promise(resolve => { setTimeout(resolve, 0) })
    })
    expect(measureInitial).toHaveBeenCalledTimes(measurementCount)

    const replacement = document.createElement('main')
    const anchor = document.createElement('div')
    anchor.dataset.slot = 'conversation'
    replacement.append(anchor)
    replacement.getBoundingClientRect = () => ({
      x: 100, y: 20, left: 100, top: 20, right: 600, bottom: 620,
      width: 500, height: 600, toJSON: () => ({}),
    })
    initialSurface.replaceWith(replacement)

    await waitFor(() => {
      expect(root.style.left).toBe('100px')
      expect(root.style.top).toBe('20px')
      expect(root.style.width).toBe('500px')
      expect(root.style.height).toBe('600px')
    })
  })

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
    expect(view.queryByTitle('Alpha')).toBeNull()
    expect(view.getByTitle('Beta').getAttribute('src')).toContain('dsh-docking-session=session-2')
    expect(view.queryByTitle('Gamma')).toBeNull()

    const betaFrame = view.getByTitle('Beta')
    act(() => { instance.actions.setEnabled(false) })
    expect(view.container.querySelector<HTMLElement>('[data-docking-layout]')?.hidden).toBe(true)
    expect(view.getByTitle('Beta')).toBe(betaFrame)
    act(() => { instance.actions.setEnabled(true) })
    expect(view.container.querySelector<HTMLElement>('[data-docking-layout]')?.hidden).toBe(false)
    expect(view.getByTitle('Beta')).toBe(betaFrame)

    const betaFrameUrl = betaFrame.getAttribute('src')
    const alpha = view.getByRole('tab', { name: /^Alpha$/ })
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() }
    fireEvent.dragStart(alpha, { dataTransfer })
    expect(view.container.querySelector('[data-dragging]')).not.toBeNull()
    fireEvent.dragEnd(alpha)
    expect(view.container.querySelector('[data-dragging]')).toBeNull()

    window.history.pushState({}, '', '/another-host-route?view=changed#details')
    fireEvent.click(alpha)
    const alphaFrame = view.getByTitle('Alpha')
    expect(alpha.getAttribute('aria-selected')).toBe('true')
    expect(view.getByTitle('Beta')).toBe(betaFrame)
    expect(betaFrame.getAttribute('src')).toBe(betaFrameUrl)
    expect(new URL(alphaFrame.getAttribute('src')!).pathname).toBe('/another-host-route')
    fireEvent.change(view.getByRole('combobox', { name: '在此分组打开会话' }), {
      target: { value: S3 },
    })
    const gammaUrl = new URL(view.getByTitle('Gamma').getAttribute('src')!)
    expect(gammaUrl.pathname).toBe('/another-host-route')
    expect(gammaUrl.searchParams.get('view')).toBe('changed')
    expect(gammaUrl.searchParams.get('dsh-docking-session')).toBe(S3)
    expect(gammaUrl.hash).toBe('#details')

    const article = view.getByRole('article')
    mockBounds(article, 641, 561)
    act(() => { window.dispatchEvent(new Event('resize')) })
    fireEvent.click(view.getByRole('button', { name: '将当前标签拆分到右侧' }))
    expect(view.getAllByRole('article')).toHaveLength(2)
    expect(view.container.querySelectorAll('iframe')).toHaveLength(3)
    expect(view.getByTitle('Alpha')).toBe(alphaFrame)
    expect(view.container.querySelectorAll('[data-docking-layout-top-right]')).toHaveLength(1)
    expect(
      view.container.querySelector('[data-docking-layout-top-right]')?.getAttribute('aria-label'),
    ).toBe('会话分组 2')

    expect(view.getByRole('navigation', { name: '切换会话分组' })).toBeTruthy()
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: (view.getByTitle('Beta') as HTMLIFrameElement).contentWindow,
        data: { type: FRAME_FOCUS_MESSAGE, sessionId: S2 },
      }))
    })
    expect(view.getByRole('article', { name: '会话分组 1' }).hasAttribute('data-active')).toBe(true)
    fireEvent.click(view.getByRole('button', { name: '显示第 2 组' }))
    expect(view.getByRole('article', { name: '会话分组 2' }).hasAttribute('data-active')).toBe(true)

    expect(view.queryByRole('button', { name: '关闭分组' })).toBeNull()
    expect(view.queryByRole('button', { name: '返回单栏模式' })).toBeNull()
  })

  it('updates directional split availability after a resize', async () => {
    const instance = createDockingLayoutStore().create()
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1, S2], active: S2,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(sessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    const article = view.getByRole('article')
    const splitRight = view.getByRole<HTMLButtonElement>('button', { name: '将当前标签拆分到右侧' })
    const splitDown = view.getByRole<HTMLButtonElement>('button', { name: '将当前标签拆分到下方' })
    mockBounds(article, 640, 561)
    act(() => { window.dispatchEvent(new Event('resize')) })
    await waitFor(() => {
      expect(splitRight.disabled).toBe(true)
      expect(splitDown.disabled).toBe(false)
    })

    mockBounds(article, 641, 560)
    act(() => { window.dispatchEvent(new Event('resize')) })
    await waitFor(() => {
      expect(splitRight.disabled).toBe(false)
      expect(splitDown.disabled).toBe(true)
    })

    mockBounds(article, 640, 560)
    fireEvent.click(splitRight)
    expect(view.getAllByRole('article')).toHaveLength(1)

    mockBounds(article, 641, 561)
    const alpha = view.getByRole('tab', { name: /^Alpha$/ })
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'move', setData: vi.fn() }
    fireEvent.dragStart(alpha, { dataTransfer })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(dragOver, { clientX: 635, clientY: 280, dataTransfer })
    fireEvent(article, dragOver)
    expect(view.container.querySelector('[data-zone="right"]')).not.toBeNull()
    mockBounds(article, 640, 561)
    fireEvent.drop(article, { dataTransfer })
    expect(view.getAllByRole('article')).toHaveLength(1)
  })

  it('allows a singleton group to move across an edge without adding a group', () => {
    const instance = createDockingLayoutStore().create()
    instance.actions.setLayout({
      kind: 'split',
      axis: 'horizontal',
      first: { kind: 'group', id: 'group-1', tabs: [S1], active: S1 },
      second: { kind: 'group', id: 'group-2', tabs: [S2], active: S2 },
    }, 'group-2', 3)
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(sessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    const alpha = view.getByRole('tab', { name: /^Alpha$/ })
    const target = view.getByRole('article', { name: '会话分组 2' })
    mockBounds(target, 400, 300)
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    fireEvent.dragStart(alpha, { dataTransfer })
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(dragOver, { clientX: 395, clientY: 150, dataTransfer })
    fireEvent(target, dragOver)
    expect(dataTransfer.dropEffect).toBe('move')
    expect(view.container.querySelector('[data-zone="right"]')).not.toBeNull()
    fireEvent.drop(target, { dataTransfer })

    expect(view.getAllByRole('article')).toHaveLength(2)
    expect(collectGroups(instance.getSnapshot().layout).map(group => group.tabs)).toEqual([
      [S2], [S1],
    ])
  })

  it('keeps only the active frame and two recently inactive frames', () => {
    const instance = createDockingLayoutStore().create()
    const extendedSessions: SessionListState = {
      ...sessions,
      ids: [S1, S2, S3, S4, S5],
      current: S1,
      byId: {
        ...sessions.byId,
        [S4]: { id: S4, displayTitle: 'Delta', running: false, blank: false, updatedAt: 4 },
        [S5]: { id: S5, displayTitle: 'Epsilon', running: false, blank: false, updatedAt: 5 },
      },
    }
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1, S2, S3, S4, S5], active: S1,
    }, 'group-1', 2)
    const view = render(createElement(StrictMode, null, createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => (
        selector(extendedSessions)
      )) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    })))

    expect(view.container.querySelectorAll('iframe')).toHaveLength(1)
    const alphaFrame = view.getByTitle('Alpha')
    fireEvent.click(view.getByRole('tab', { name: /^Beta$/ }))
    const betaFrame = view.getByTitle('Beta')
    expect(view.getByTitle('Alpha')).toBe(alphaFrame)
    fireEvent.click(view.getByRole('tab', { name: /^Gamma$/ }))
    const gammaFrame = view.getByTitle('Gamma')
    expect(view.container.querySelectorAll('iframe')).toHaveLength(3)

    fireEvent.click(view.getByRole('tab', { name: /^Delta$/ }))
    expect(view.container.querySelectorAll('iframe')).toHaveLength(3)
    expect(view.queryByTitle('Alpha')).toBeNull()
    expect(view.getByTitle('Beta')).toBe(betaFrame)
    expect(view.getByTitle('Gamma')).toBe(gammaFrame)

    window.history.pushState({}, '', '/remounted-frame')
    fireEvent.click(view.getByRole('tab', { name: /^Alpha$/ }))
    const remountedAlpha = view.getByTitle('Alpha')
    expect(remountedAlpha).not.toBe(alphaFrame)
    expect(new URL(remountedAlpha.getAttribute('src')!).pathname).toBe('/remounted-frame')
    expect(view.queryByTitle('Beta')).toBeNull()
    expect(view.container.querySelectorAll('iframe')).toHaveLength(3)
  })

  it('pins every group active frame in addition to the two-frame LRU', () => {
    const instance = createDockingLayoutStore().create()
    const extendedSessions: SessionListState = {
      ...sessions,
      ids: [S1, S2, S3, S4],
      current: S1,
      byId: {
        ...sessions.byId,
        [S4]: { id: S4, displayTitle: 'Delta', running: false, blank: false, updatedAt: 4 },
      },
    }
    instance.actions.setLayout({
      kind: 'split',
      axis: 'horizontal',
      first: { kind: 'group', id: 'group-1', tabs: [S1, S2], active: S1 },
      second: { kind: 'group', id: 'group-2', tabs: [S3, S4], active: S3 },
    }, 'group-1', 3)
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => (
        selector(extendedSessions)
      )) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    expect(view.container.querySelectorAll('iframe')).toHaveLength(2)
    const alphaFrame = view.getByTitle('Alpha')
    const gammaFrame = view.getByTitle('Gamma')
    fireEvent.click(view.getByRole('tab', { name: /^Beta$/ }))
    const betaFrame = view.getByTitle('Beta')
    expect(view.getByTitle('Gamma')).toBe(gammaFrame)
    fireEvent.click(view.getByRole('tab', { name: /^Delta$/ }))
    const deltaFrame = view.getByTitle('Delta')
    expect(view.getByTitle('Beta')).toBe(betaFrame)
    expect(view.container.querySelectorAll('iframe')).toHaveLength(4)

    fireEvent.click(view.getByRole('tab', { name: /^Alpha$/ }))
    expect(view.getByTitle('Alpha')).toBe(alphaFrame)
    expect(view.getByTitle('Delta')).toBe(deltaFrame)
    expect(view.container.querySelectorAll('iframe')).toHaveLength(4)
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
    const article = view.getByRole('article')
    mockBounds(article, 641, 561)
    act(() => { window.dispatchEvent(new Event('resize')) })
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'move', setData: vi.fn() }
    const alpha = view.getByRole('tab', { name: /^Alpha$/ })
    fireEvent.dragStart(alpha, { dataTransfer })
    expect(view.getAllByRole('tab')).toHaveLength(1)
    expect(view.container.querySelector('[data-dragging]')).not.toBeNull()
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(dragOver, { clientX: 5, clientY: 150, dataTransfer })
    fireEvent(article, dragOver)
    expect(dataTransfer.dropEffect).toBe('none')
    expect(view.container.querySelector('[data-zone]')).toBeNull()
    fireEvent.dragEnd(alpha)

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

  it('waits for an asynchronous New Session before replacing the final tab', async () => {
    const instance = createDockingLayoutStore().create()
    let sessionState: SessionListState = sessions
    const listeners = new Set<() => void>()
    const sessionSource: HostObservable<SessionListState> = {
      getSnapshot: () => sessionState,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    let workspaceState = workspaces
    const workspaceListeners = new Set<() => void>()
    const workspaceSource: HostObservable<WorkspaceListState> = {
      getSnapshot: () => workspaceState,
      subscribe: (listener) => {
        workspaceListeners.add(listener)
        return () => { workspaceListeners.delete(listener) }
      },
    }
    const startSession = vi.fn()
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1, S2], active: S2,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: bindSnapshotSelector(sessionSource),
      useWorkspaces: bindSnapshotSelector(workspaceSource),
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession,
      t: makeTranslate(zh),
    }))

    fireEvent.click(view.getByRole('button', { name: '关闭标签: Beta' }))
    expect(view.queryByRole('tab', { name: /^Beta$/ })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '关闭标签: Alpha' }))

    expect(startSession).toHaveBeenCalledOnce()
    const pendingClose = view.getByRole<HTMLButtonElement>('button', { name: '关闭标签: Alpha' })
    expect(pendingClose.disabled).toBe(true)
    expect(view.getByRole<HTMLSelectElement>('combobox', {
      name: '在此分组打开会话',
    }).disabled).toBe(true)
    expect(view.getByRole<HTMLButtonElement>('button', {
      name: '将当前标签拆分到右侧',
    }).disabled).toBe(true)
    expect(view.getByRole<HTMLButtonElement>('button', {
      name: '将当前标签拆分到下方',
    }).disabled).toBe(true)
    fireEvent.click(pendingClose)
    expect(startSession).toHaveBeenCalledOnce()
    expect(view.getByRole('tab', { name: /^Alpha$/ })).toBeTruthy()
    expect(view.queryByRole('tab', { name: /^Beta$/ })).toBeNull()

    act(() => {
      workspaceState = { ...workspaceState, phase: 'pending' }
      for (const listener of workspaceListeners) listener()
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

    expect(collectSessionIds(instance.getSnapshot().layout)).toEqual([S1])

    act(() => {
      workspaceState = workspaces
      for (const listener of workspaceListeners) listener()
    })

    await waitFor(() => {
      expect(view.getByRole('tab', { name: /^New Session$/ })).toBeTruthy()
    })
    expect(view.queryByRole('tab', { name: /^Alpha$/ })).toBeNull()
    expect(view.queryByRole('tab', { name: /^Beta$/ })).toBeNull()
  })

  it('does not treat unrelated navigation as the pending final-tab replacement', async () => {
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
    const startSession = vi.fn()
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1], active: S1,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: bindSnapshotSelector(sessionSource),
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => (
        selector(workspaces)
      )) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession,
      t: makeTranslate(zh),
    }))

    fireEvent.click(view.getByRole('button', { name: '关闭标签: Alpha' }))
    act(() => {
      sessionState = { ...sessionState, current: S2 }
      for (const listener of listeners) listener()
    })
    await waitFor(() => {
      expect(view.getByRole('tab', { name: /^Beta$/ })).toBeTruthy()
    })
    expect(view.getByRole('tab', { name: /^Alpha$/ })).toBeTruthy()

    act(() => {
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
    await waitFor(() => {
      expect(view.getByRole('tab', { name: /^New Session$/ })).toBeTruthy()
    })
    expect(view.getByRole('tab', { name: /^Alpha$/ })).toBeTruthy()
    expect(view.getByRole('tab', { name: /^Beta$/ })).toBeTruthy()
  })

  it('reopens or focuses the unchanged outer Session when its sidebar row is reselected', () => {
    const instance = createDockingLayoutStore().create()
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1, S2], active: S2,
    }, 'group-1', 2)
    const sidebar = document.createElement('aside')
    sidebar.dataset.slot = 'sidebar'
    const selectedRow = document.createElement('div')
    selectedRow.setAttribute('role', 'treeitem')
    selectedRow.setAttribute('aria-selected', 'true')
    sidebar.append(selectedRow)
    document.body.append(sidebar)
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(sessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => (
        selector(workspaces)
      )) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    fireEvent.click(view.getByRole('tab', { name: /^Alpha$/ }))
    expect(view.getByRole('tab', { name: /^Alpha$/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(selectedRow)
    expect(view.getByRole('tab', { name: /^Beta$/ }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(view.getByRole('button', { name: '关闭标签: Beta' }))
    expect(view.queryByRole('tab', { name: /^Beta$/ })).toBeNull()
    fireEvent.click(selectedRow)
    expect(view.getByRole('tab', { name: /^Beta$/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps an open blank Session after outer navigation changes', () => {
    const instance = createDockingLayoutStore().create()
    const blankSessions: SessionListState = {
      ...sessions,
      current: S1,
      byId: {
        ...sessions.byId,
        [S2]: { ...sessions.byId[S2]!, blank: true },
      },
    }
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S2], active: S2,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => selector(blankSessions)) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector(workspaces)) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    expect(view.getByRole('article')).toBeTruthy()
    expect(view.getByRole('tab', { name: /^Alpha$/ })).toBeTruthy()
    const beta = view.getByRole('tab', { name: /^Beta$/ })
    expect(beta).toBeTruthy()
    expect(view.queryByTitle('Beta')).toBeNull()
    fireEvent.click(beta)
    expect(view.getByTitle('Beta').getAttribute('src')).toContain(
      'dsh-docking-session=session-2',
    )
  })

  it('replaces a blank tab when its Workspace changes without opening history', async () => {
    const instance = createDockingLayoutStore().create()
    let sessionState: SessionListState = {
      ...sessions,
      current: S1,
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
    let workspaceState: WorkspaceListState = workspaces
    const workspaceListeners = new Set<() => void>()
    const workspaceSource: HostObservable<WorkspaceListState> = {
      getSnapshot: () => workspaceState,
      subscribe: (listener) => {
        workspaceListeners.add(listener)
        return () => { workspaceListeners.delete(listener) }
      },
    }
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1, S2], active: S2,
    }, 'group-1', 2)
    const view = render(createElement(DockingLayout, {
      useSessions: bindSnapshotSelector(sessionSource),
      useWorkspaces: bindSnapshotSelector(workspaceSource),
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    fireEvent.click(view.getByRole('button', { name: '关闭标签: Alpha' }))
    expect(view.getAllByRole('tab')).toHaveLength(1)
    expect(view.getByRole('tab', { name: /^Beta$/ })).toBeTruthy()
    const betaFrame = view.getByTitle('Beta') as HTMLIFrameElement

    act(() => {
      workspaceState = { ...workspaceState, phase: 'pending' }
      for (const listener of workspaceListeners) listener()
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: betaFrame.contentWindow,
        data: {
          type: FRAME_NAVIGATE_MESSAGE,
          sourceSessionId: S2,
          sessionId: S4,
          replaceSource: true,
        },
      }))
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

    expect(collectSessionIds(instance.getSnapshot().layout)).toEqual([S2])

    act(() => {
      workspaceState = { ...workspaceState, phase: 'ready' }
      for (const listener of workspaceListeners) listener()
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

  it('tracks native navigation while Docking Layout is disabled', async () => {
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
    instance.actions.setLayout({
      kind: 'group', id: 'group-1', tabs: [S1], active: S1,
    }, 'group-1', 2)
    instance.actions.setEnabled(false)
    const view = render(createElement(DockingLayout, {
      useSessions: bindSnapshotSelector(sessionSource),
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => (
        selector(workspaces)
      )) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    act(() => {
      sessionState = { ...sessionState, current: S3 }
      for (const listener of listeners) listener()
    })
    await waitFor(() => {
      expect(collectSessionIds(instance.getSnapshot().layout)).toContain(S3)
    })

    act(() => { instance.actions.setEnabled(true) })
    expect(view.getByRole('tab', { name: /^Gamma$/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('preserves the persisted split tree until the Session list is ready', async () => {
    const instance = createDockingLayoutStore().create()
    const savedLayout: SessionLayoutNode = {
      kind: 'split',
      axis: 'horizontal',
      first: { kind: 'group', id: 'group-1', tabs: [S1], active: S1 },
      second: { kind: 'group', id: 'group-2', tabs: [S2], active: S2 },
    }
    instance.actions.setLayout(savedLayout, 'group-2', 3)
    let sessionState: SessionListState = {
      ...sessions, ids: [], byId: {}, current: undefined, phase: 'pending',
    }
    const listeners = new Set<() => void>()
    const sessionSource: HostObservable<SessionListState> = {
      getSnapshot: () => sessionState,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const view = render(createElement(DockingLayout, {
      useSessions: bindSnapshotSelector(sessionSource),
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => (
        selector(workspaces)
      )) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    expect(instance.getSnapshot().layout).toEqual(savedLayout)
    expect(view.container.firstChild).toBeNull()

    act(() => {
      sessionState = { ...sessions, current: S2 }
      for (const listener of listeners) listener()
    })
    await waitFor(() => { expect(view.getAllByRole('article')).toHaveLength(2) })
    expect(instance.getSnapshot().layout).toEqual(savedLayout)
  })

  it('waits for Workspace metadata before filtering persisted tabs', async () => {
    const instance = createDockingLayoutStore().create()
    const savedLayout: SessionLayoutNode = {
      kind: 'group', id: 'group-1', tabs: [S1], active: S1,
    }
    instance.actions.setLayout(savedLayout, 'group-1', 2)
    let workspaceState: WorkspaceListState = { ...workspaces, phase: 'pending' }
    const listeners = new Set<() => void>()
    const workspaceSource: HostObservable<WorkspaceListState> = {
      getSnapshot: () => workspaceState,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const view = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => (
        selector({ ...sessions, current: S1 })
      )) as never,
      useWorkspaces: bindSnapshotSelector(workspaceSource),
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    expect(view.container.firstChild).toBeNull()
    expect(instance.getSnapshot().layout).toEqual(savedLayout)

    act(() => {
      workspaceState = { ...workspaces, archivedSessionIds: [S1] }
      for (const listener of listeners) listener()
    })
    await waitFor(() => {
      expect(document.body.hasAttribute('data-dsh-docking-layout-active')).toBe(false)
    })
    expect(view.container.querySelector('iframe')).toBeNull()
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

  it('falls back to the native view for archived and subagent navigation targets', () => {
    const instance = createDockingLayoutStore().create()
    const archivedView = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => (
        selector({ ...sessions, current: S1 })
      )) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => selector({
        ...workspaces, archivedSessionIds: [S1],
      })) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    expect(archivedView.container.firstChild).toBeNull()
    expect(document.body.hasAttribute('data-dsh-docking-layout-active')).toBe(false)
    archivedView.unmount()

    const subagentSessions: SessionListState = {
      ...sessions,
      ids: [...sessions.ids, S4],
      current: S4,
      byId: {
        ...sessions.byId,
        [S4]: {
          id: S4, displayTitle: 'Child', running: false, blank: false, updatedAt: 4,
          origin: 'subagent', parentId: S1,
        },
      },
    }
    const subagentView = render(createElement(DockingLayout, {
      useSessions: ((selector: (state: SessionListState) => unknown) => (
        selector(subagentSessions)
      )) as never,
      useWorkspaces: ((selector: (state: WorkspaceListState) => unknown) => (
        selector(workspaces)
      )) as never,
      useStore: bindSnapshotSelector(instance.store),
      actions: instance.actions,
      startSession: vi.fn(),
      t: makeTranslate(zh),
    }))

    expect(subagentView.container.firstChild).toBeNull()
    expect(document.body.hasAttribute('data-dsh-docking-layout-active')).toBe(false)
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
  it('updates the existing generated stylesheet during hot reload', () => {
    const runStyleModule = (css: string): void => {
      const source = styleModule('/tmp/DockingLayout.module.css', css, { root: 'root' })
      Function(source.slice(0, source.lastIndexOf('export default')))()
    }

    runStyleModule('.root{color:red}')
    const selector = 'style[data-plugin-css="@ai-eks/dsh-docking-layout/DockingLayout.module.css"]'
    const initial = document.head.querySelector<HTMLStyleElement>(selector)
    expect(initial?.textContent).toBe('.root{color:red}')

    runStyleModule('.root{color:blue}')
    expect(document.head.querySelectorAll(selector)).toHaveLength(1)
    expect(document.head.querySelector(selector)).toBe(initial)
    expect(initial?.textContent).toBe('.root{color:blue}')
  })

  it('registers only stock root slots and restores outer navigation after frame startup', () => {
    const open = vi.fn()
    let outerSessions = sessions
    const outerListeners = new Set<() => void>()
    const disposeLocale = vi.fn()
    const disposeLayout = vi.fn()
    const disposers: Array<() => void> = []
    const entries = new Map<string, { options: Record<string, unknown>; component: unknown }>()
    const ctx = {
      effect: (install: () => () => void) => { disposers.push(install()) },
      locale: { register: vi.fn(() => disposeLocale) },
      sessions: {
        list: {
          getSnapshot: () => outerSessions,
          subscribe: (listener: () => void) => {
            outerListeners.add(listener)
            return () => { outerListeners.delete(listener) }
          },
        },
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

    const frameOne = document.createElement('iframe')
    frameOne.setAttribute('data-docking-layout-session-frame', S1)
    const frameTwo = document.createElement('iframe')
    frameTwo.setAttribute('data-docking-layout-session-frame', S2)
    document.body.append(frameOne, frameTwo)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frameOne.contentWindow,
      data: { type: FRAME_READY_MESSAGE, sessionId: S1 },
    }))
    expect(open).toHaveBeenCalledWith(S2)

    open.mockClear()
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frameTwo.contentWindow,
      data: {
        type: FRAME_NAVIGATE_MESSAGE,
        sourceSessionId: S2,
        sessionId: S1,
        replaceSource: false,
      },
    }))
    expect(open).toHaveBeenCalledWith(S1)

    open.mockClear()
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frameTwo.contentWindow,
      data: {
        type: FRAME_NAVIGATE_MESSAGE,
        sourceSessionId: S2,
        sessionId: S4,
        replaceSource: true,
      },
    }))
    expect(open).not.toHaveBeenCalled()
    outerSessions = {
      ...outerSessions,
      ids: [...outerSessions.ids, S4],
      phase: 'pending',
      byId: {
        ...outerSessions.byId,
        [S4]: {
          id: S4, displayTitle: 'New Session', running: false, blank: true, updatedAt: 4,
        },
      },
    }
    for (const listener of outerListeners) listener()
    expect(open).toHaveBeenCalledWith(S4)

    outerSessions = { ...outerSessions, phase: 'ready' }
    for (const listener of outerListeners) listener()
    expect(open).toHaveBeenCalledTimes(2)

    outerSessions = { ...outerSessions, current: S4 }
    for (const listener of outerListeners) listener()
    expect(open).toHaveBeenCalledTimes(2)

    const staleSource = frameTwo.contentWindow
    frameTwo.remove()
    const remountedFrameTwo = document.createElement('iframe')
    remountedFrameTwo.setAttribute('data-docking-layout-session-frame', S2)
    document.body.append(remountedFrameTwo)
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: staleSource,
      data: {
        type: FRAME_NAVIGATE_MESSAGE,
        sourceSessionId: S2,
        sessionId: S1,
        replaceSource: false,
      },
    }))
    expect(open).toHaveBeenCalledTimes(2)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frameOne.contentWindow,
      data: { type: FRAME_TOGGLE_SIDEBAR_MESSAGE },
    }))
    expect(ctx.layout.toggleSidebar).toHaveBeenCalledOnce()

    for (const dispose of disposers.reverse()) dispose()
    expect(outerListeners.size).toBe(0)
    expect(disposeLayout).toHaveBeenCalledOnce()
    expect(disposeLocale).toHaveBeenCalledOnce()
  })

  it('locks an addressed embedded client and removes its duplicate shell chrome', async () => {
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
    expect(postFrameMessage).toHaveBeenCalledWith({
      type: FRAME_READY_MESSAGE,
      sessionId: S1,
    })

    state = { ...state, current: S2 }
    for (const listener of listeners) listener()
    expect(postFrameMessage).toHaveBeenCalledWith({
      type: FRAME_NAVIGATE_MESSAGE,
      sourceSessionId: S1,
      sessionId: S2,
      replaceSource: false,
    })
    expect(open).toHaveBeenLastCalledWith(S1)
    window.dispatchEvent(new FocusEvent('focus'))
    expect(postFrameMessage).toHaveBeenCalledWith({
      type: FRAME_FOCUS_MESSAGE,
      sessionId: S1,
    })
    window.dispatchEvent(new Event('pointerdown'))
    expect(postFrameMessage).toHaveBeenLastCalledWith({
      type: FRAME_FOCUS_MESSAGE,
      sessionId: S1,
    })
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

    const querySelector = vi.spyOn(document, 'querySelector')
    const queryCount = querySelector.mock.calls.length
    conversation.append(document.createElement('p'))
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(querySelector).toHaveBeenCalledTimes(queryCount)
    querySelector.mockRestore()

    const nextShell = document.createElement('div')
    const nextSidebarParent = document.createElement('aside')
    const nextSidebar = document.createElement('div')
    nextSidebar.dataset.slot = 'sidebar'
    nextSidebarParent.append(nextSidebar)
    const nextConversationParent = document.createElement('main')
    const nextConversation = document.createElement('div')
    nextConversation.dataset.slot = 'conversation'
    nextConversationParent.append(nextConversation)
    const nextDetailsParent = document.createElement('aside')
    const nextDetails = document.createElement('div')
    nextDetails.dataset.slot = 'details'
    nextDetailsParent.append(nextDetails)
    nextShell.append(nextSidebarParent, nextConversationParent, nextDetailsParent)
    shell.replaceWith(nextShell)

    await waitFor(() => {
      expect(nextShell.hasAttribute('data-dsh-docking-frame-shell')).toBe(true)
      expect(nextSidebarParent.hasAttribute('data-dsh-docking-frame-sidebar')).toBe(true)
      expect(nextConversationParent.hasAttribute('data-dsh-docking-frame-conversation')).toBe(true)
      expect(nextDetailsParent.hasAttribute('data-dsh-docking-frame-details')).toBe(true)
    })

    stopFollowing()
    removePresentation()
    fireEvent.click(mobileToggle)
    expect(postFrameMessage).toHaveBeenCalledTimes(messageCount + 1)
    expect(document.body.hasAttribute('data-dsh-docking-frame')).toBe(false)
    expect(shell.hasAttribute('data-dsh-docking-frame-shell')).toBe(false)
    expect(sidebarParent.hasAttribute('data-dsh-docking-frame-sidebar')).toBe(false)
    expect(conversationParent.hasAttribute('data-dsh-docking-frame-conversation')).toBe(false)
    expect(detailsParent.hasAttribute('data-dsh-docking-frame-details')).toBe(false)
    expect(nextShell.hasAttribute('data-dsh-docking-frame-shell')).toBe(false)
    expect(nextSidebarParent.hasAttribute('data-dsh-docking-frame-sidebar')).toBe(false)
    expect(nextConversationParent.hasAttribute('data-dsh-docking-frame-conversation')).toBe(false)
    expect(nextDetailsParent.hasAttribute('data-dsh-docking-frame-details')).toBe(false)
  })

  it('retries an addressed frame Session when the list phase becomes ready', () => {
    let state: SessionListState = { ...sessions, phase: 'pending' }
    const listeners = new Set<() => void>()
    const open = vi.fn((id: SessionId) => {
      if (open.mock.calls.length < 2) return
      state = { ...state, current: id }
      for (const listener of listeners) listener()
    })
    const service = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
      open,
    }
    const postFrameMessage = vi.fn()
    const stop = followFrameSession(service as never, S1, postFrameMessage)

    expect(open).toHaveBeenCalledTimes(1)
    state = { ...state, phase: 'ready' }
    for (const listener of listeners) listener()

    expect(open).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenLastCalledWith(S1)
    expect(postFrameMessage).toHaveBeenCalledWith({
      type: FRAME_READY_MESSAGE,
      sessionId: S1,
    })
    stop()
  })

  it('forwards each frame navigation while one addressed reopen remains pending', () => {
    let state: SessionListState = { ...sessions, current: S1 }
    const listeners = new Set<() => void>()
    const open = vi.fn()
    const service = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
      open,
    }
    const postFrameMessage = vi.fn()
    const stop = followFrameSession(service as never, S1, postFrameMessage)

    state = { ...state, current: S2 }
    for (const listener of listeners) listener()
    state = { ...state, current: S3 }
    for (const listener of listeners) listener()

    expect(postFrameMessage).toHaveBeenCalledWith({
      type: FRAME_NAVIGATE_MESSAGE,
      sourceSessionId: S1,
      sessionId: S2,
      replaceSource: false,
    })
    expect(postFrameMessage).toHaveBeenCalledWith({
      type: FRAME_NAVIGATE_MESSAGE,
      sourceSessionId: S1,
      sessionId: S3,
      replaceSource: false,
    })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(S1)
    stop()
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
