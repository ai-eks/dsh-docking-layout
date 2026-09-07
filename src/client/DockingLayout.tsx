/** VS Code-style Session tabs and drag-to-split conversation groups. */
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties,
  type DragEvent, type PointerEvent, type ReactNode,
} from 'react'
import type {
  PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconCloseFill14,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { createDockingLayoutStore } from './stores.ts'
import {
  activateTab, closeTab, collectGroups, collectSessionIds, moveTab, openTab,
  reconcileSessionLayout, replaceTab, resolveDropZone, sameLayout, splitTab, type DropZone,
  type SessionLayoutNode, type SessionLayoutResult, type SessionTabGroup,
} from './layout.ts'
import {
  isFrameFocusMessage, isFrameNavigateMessage, isMountedFrameMessage, sessionFrameUrl,
} from './frame.ts'
import css from './DockingLayout.module.css'

/** Retain slot and standard-prop augmentations in published declarations. */
export type {} from '@deepseek-ai/dsh-client-ui-layout/client'
export type {} from '@deepseek-ai/dsh-client-ui-session/client'
export type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
export type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Complete props of the root-scoped Docking Layout overlay. */
export type DockingLayoutProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createDockingLayoutStore>>
  & PropsLocale<'docking-layout'>
  & { startSession: (onStarted: (sessionId: SessionId | undefined) => void) => void }

/** Props for the root-scoped sidebar footer affordance. */
export type DockingLayoutFooterActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createDockingLayoutStore>>
  & PropsLocale<'docking-layout'>

interface DraggedTab {
  readonly groupId: string
  readonly sessionId: SessionId
}

interface DropTarget {
  readonly groupId: string
  readonly zone: DropZone
}

interface PendingFinalClose {
  readonly groupId: string
  readonly outerCurrent: SessionId | undefined
  readonly sessionId?: SessionId
}

interface PendingFrameReplacement {
  readonly sourceSessionId: SessionId
  readonly sessionId: SessionId
}

const UNSEEN_NAVIGATION = Symbol('unseen navigation')

interface SurfaceBounds {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

const RECENT_FRAME_LIMIT = 2

function equalBounds(left: SurfaceBounds | undefined, right: SurfaceBounds): boolean {
  return left?.left === right.left && left.top === right.top
    && left.width === right.width && left.height === right.height
}

function equalSessionIds(left: readonly SessionId[], right: readonly SessionId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function updateFrameHistory(
  current: readonly SessionId[],
  active: readonly SessionId[],
  open: readonly SessionId[],
): readonly SessionId[] {
  const openSet = new Set(open)
  const activeSet = new Set(active)
  const next = [
    ...active,
    ...current.filter(id => openSet.has(id) && !activeSet.has(id)),
  ].slice(0, active.length + RECENT_FRAME_LIMIT)
  return equalSessionIds(current, next) ? current : next
}

function SessionFrame({
  sessionId, title,
}: {
  readonly sessionId: SessionId
  readonly title: string
}): ReactNode {
  const [src] = useState(() => sessionFrameUrl(sessionId))
  return (
    <iframe
      className={css.sessionFrame}
      src={src}
      title={title}
      allow="clipboard-read; clipboard-write"
      referrerPolicy="same-origin"
      data-docking-layout-session-frame={sessionId}
    />
  )
}

/** Matching destination icons for entering and leaving the docking layout. */
function LayoutIcon({ docked, size = 14 }: { docked: boolean; size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      data-docking-layout-docked-icon={docked || undefined}
      data-docking-layout-single-icon={!docked || undefined}
    >
      <rect
        x="1.25"
        y="1.25"
        width="13.5"
        height="13.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M1.75 5.25H14.25" stroke="currentColor" strokeWidth="1.3" />
      {docked ? <path d="M8 5.75V14.25" stroke="currentColor" strokeWidth="1.3" /> : null}
    </svg>
  )
}

/** Track the stock conversation column after native and external panel concessions. */
function useConversationSurface(): CSSProperties {
  const [bounds, setBounds] = useState<SurfaceBounds>()
  useEffect(() => {
    let observed: Element | undefined
    let discovery: MutationObserver | undefined
    const measure = (): void => {
      const nextObserved = document.querySelector('[data-slot="conversation"]')?.parentElement
      if (nextObserved === null || nextObserved === undefined) return
      if (observed !== nextObserved) {
        if (observed !== undefined) resize?.unobserve(observed)
        observed = nextObserved
        resize?.observe(nextObserved)
      }
      const rect = nextObserved.getBoundingClientRect()
      const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      setBounds(current => equalBounds(current, next) ? current : next)
    }
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    const containsConversationSlot = (node: Node): boolean => node instanceof Element && (
      node.matches('[data-slot="conversation"]')
      || node.querySelector('[data-slot="conversation"]') !== null
    )
    discovery = new MutationObserver((records) => {
      const surfaceChanged = records.some(record => (
        Array.from(record.addedNodes).some(containsConversationSlot)
        || Array.from(record.removedNodes).some(node => (
          containsConversationSlot(node)
          || node === observed
          || (node instanceof Element && observed !== undefined && node.contains(observed))
        ))
      ))
      if (surfaceChanged) measure()
    })
    discovery.observe(document.documentElement, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    measure()
    return () => {
      resize?.disconnect()
      discovery?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return useMemo(() => bounds === undefined
    ? { visibility: 'hidden' }
    : { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
  [bounds])
}

/**
 * Keep the layout toggle in the persistent DSH sidebar footer.
 * @param props - sidebar width state and the shared root layout store.
 * @returns the action for entering or leaving Docking Layout.
 */
export function DockingLayoutFooterAction({
  wide, useStore, actions, t,
}: DockingLayoutFooterActionProps): ReactNode {
  const enabled = useStore(state => state.enabled)
  const label = t(enabled ? 'action.single' : 'action.open')
  return (
    <button
      className={css.footerAction}
      data-wide={wide || undefined}
      type="button"
      aria-label={label}
      title={label}
      onClick={() => { actions.setEnabled(!enabled) }}
    >
      <LayoutIcon docked={!enabled} size={wide ? 16 : 18} />
      {wide ? <span>{label}</span> : null}
    </button>
  )
}

/**
 * Render Session tabs and recursive editor groups over native conversation panes.
 * @param props - layout owner, live Session list, preference store, and runtime actions.
 * @returns the current single-pane or tabbed workbench layout.
 */
export function DockingLayout({
  useSessions, useStore, actions, useWorkspaces, startSession, t,
}: DockingLayoutProps): ReactNode {
  const sessions = useSessions(state => state)
  const current = sessions.current
  const workspaceState = useWorkspaces(state => state)
  const archivedSessionIds = workspaceState.archivedSessionIds
  const grid = useStore(state => state)
  const surfaceStyle = useConversationSurface()
  const previousNavigation = useRef<SessionId | undefined | typeof UNSEEN_NAVIGATION>(
    UNSEEN_NAVIGATION,
  )
  const [dragged, setDragged] = useState<DraggedTab>()
  const [dropTarget, setDropTarget] = useState<DropTarget>()
  const [pendingFinalClose, setPendingFinalClose] = useState<PendingFinalClose>()
  const [pendingFrameReplacement, setPendingFrameReplacement] = useState<PendingFrameReplacement>()
  const [frameHistory, setFrameHistory] = useState<readonly SessionId[]>([])
  const rootRef = useRef<HTMLElement | null>(null)
  const groupBodyRefs = useRef(new Map<string, HTMLDivElement>())
  const framePanelRefs = useRef(new Map<SessionId, HTMLDivElement>())
  const layoutHasMounted = useRef(false)
  const sessionsReady = sessions.phase === 'ready'
  const workspacesReady = workspaceState.phase === 'ready'
  const dataReady = sessionsReady && workspacesReady
  const archived = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const docked = useMemo(() => new Set(collectSessionIds(grid.layout)), [grid.layout])
  const eligible = useMemo(
    () => sessions.ids.filter((id) => {
      const session = sessions.byId[id]
      return session !== undefined
        && (session.blank === false || id === current || docked.has(id))
        && session.origin !== 'subagent'
        && !archived.has(id)
    }),
    [archived, current, docked, sessions],
  )
  const pendingReplacement = pendingFinalClose !== undefined
    && current !== undefined
    && current === pendingFinalClose.sessionId
    && sessions.byId[current]?.blank === true
  const frameReplacementReady = pendingFrameReplacement !== undefined
    && current === pendingFrameReplacement.sessionId
    && sessions.byId[current]?.blank === true
  const reconciled = useMemo(
    () => {
      if (!dataReady) {
        return {
          layout: grid.layout,
          activeGroupId: grid.activeGroupId,
          nextGroup: grid.nextGroup,
        }
      }
      const sourceLayout = pendingReplacement
        ? {
            kind: 'group' as const,
            id: pendingFinalClose.groupId,
            tabs: [current] as const,
            active: current,
          }
        : frameReplacementReady
          ? replaceTab(
              grid.layout,
              pendingFrameReplacement.sourceSessionId,
              pendingFrameReplacement.sessionId,
            )
          : grid.layout
      return reconcileSessionLayout(
        sourceLayout, eligible, current, grid.activeGroupId, grid.nextGroup,
        previousNavigation.current !== current,
      )
    },
    [
      current, eligible, grid.activeGroupId, grid.layout, grid.nextGroup, pendingFinalClose,
      dataReady, frameReplacementReady, pendingFrameReplacement, pendingReplacement,
    ],
  )
  const sessionIds = useMemo(() => collectSessionIds(reconciled.layout), [reconciled.layout])
  const groups = useMemo(() => collectGroups(reconciled.layout), [reconciled.layout])
  const activeFrameIds = useMemo(() => groups.map(group => group.active), [groups])
  const retainedFrameIds = useMemo(() => {
    const active = new Set(activeFrameIds)
    const open = new Set(sessionIds)
    return [
      ...activeFrameIds,
      ...frameHistory.filter(id => open.has(id) && !active.has(id)).slice(0, RECENT_FRAME_LIMIT),
    ]
  }, [activeFrameIds, frameHistory, sessionIds])
  const retainedFrameIdSet = useMemo(() => new Set(retainedFrameIds), [retainedFrameIds])
  const currentIsEligible = current !== undefined && eligible.includes(current)
  const persistedMatches = sameLayout(grid.layout, reconciled.layout)
    && grid.activeGroupId === reconciled.activeGroupId
    && grid.nextGroup === reconciled.nextGroup

  useEffect(() => {
    if (dataReady) previousNavigation.current = current
  }, [current, dataReady])

  useEffect(() => {
    setFrameHistory(history => updateFrameHistory(history, activeFrameIds, sessionIds))
  }, [activeFrameIds, sessionIds])

  useEffect(() => {
    if (!persistedMatches) {
      actions.setLayout(reconciled.layout, reconciled.activeGroupId, reconciled.nextGroup)
    }
  }, [actions, persistedMatches, reconciled])

  useEffect(() => {
    if (
      pendingFinalClose !== undefined
      && current !== undefined
      && (pendingReplacement
        ? dataReady && persistedMatches
        : current !== pendingFinalClose.outerCurrent)
    ) {
      setPendingFinalClose(undefined)
    }
  }, [current, dataReady, pendingFinalClose, pendingReplacement, persistedMatches])

  useEffect(() => {
    if (dataReady && frameReplacementReady && persistedMatches) {
      setPendingFrameReplacement(undefined)
    }
  }, [dataReady, frameReplacementReady, persistedMatches])

  useEffect(() => {
    const handleFrameMessage = (event: MessageEvent<unknown>): void => {
      if (isFrameNavigateMessage(event) && event.data.replaceSource) {
        if (!isMountedFrameMessage(event, event.data.sourceSessionId)) return
        setPendingFrameReplacement({
          sourceSessionId: event.data.sourceSessionId,
          sessionId: event.data.sessionId,
        })
        return
      }
      if (!isFrameFocusMessage(event) || reconciled.layout === undefined) return
      if (!isMountedFrameMessage(event, event.data.sessionId)) return
      const owner = groups.find(group => group.active === event.data.sessionId)
      if (owner !== undefined && owner.id !== reconciled.activeGroupId) {
        actions.setLayout(reconciled.layout, owner.id, reconciled.nextGroup)
      }
    }
    window.addEventListener('message', handleFrameMessage)
    return () => { window.removeEventListener('message', handleFrameMessage) }
  }, [actions, groups, reconciled])

  const layoutVisible = grid.enabled && dataReady && currentIsEligible
  if (layoutVisible) layoutHasMounted.current = true
  useEffect(() => {
    document.body.toggleAttribute('data-dsh-docking-layout-active', layoutVisible)
    return () => { document.body.removeAttribute('data-dsh-docking-layout-active') }
  }, [layoutVisible])

  useEffect(() => {
    const reopenSelectedSidebarSession = (event: MouseEvent): void => {
      const target = event.target
      if (
        !(target instanceof Element)
        || !layoutVisible
        || current === undefined
        || pendingFinalClose !== undefined
      ) return
      const row = target.closest('[role="treeitem"][aria-selected="true"]')
      if (row === null || row.closest('[data-slot="sidebar"]') === null) return
      const groupId = reconciled.activeGroupId ?? groups[0]?.id
      if (reconciled.layout === undefined || groupId === undefined) return
      const result = openTab(reconciled.layout, groupId, current, reconciled.nextGroup)
      if (
        !sameLayout(reconciled.layout, result.layout)
        || reconciled.activeGroupId !== result.activeGroupId
      ) {
        actions.setLayout(result.layout, result.activeGroupId, result.nextGroup)
      }
    }
    document.addEventListener('click', reopenSelectedSidebarSession)
    return () => { document.removeEventListener('click', reopenSelectedSidebarSession) }
  }, [actions, current, groups, layoutVisible, pendingFinalClose, reconciled])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!layoutVisible || reconciled.layout === undefined || root === null) return
    const sync = (): void => {
      const rootRect = root.getBoundingClientRect()
      for (const group of groups) {
        const body = groupBodyRefs.current.get(group.id)
        if (body === undefined) continue
        const rect = body.getBoundingClientRect()
        for (const sessionId of group.tabs) {
          const panel = framePanelRefs.current.get(sessionId)
          if (panel === undefined) continue
          panel.style.left = `${rect.left - rootRect.left}px`
          panel.style.top = `${rect.top - rootRect.top}px`
          panel.style.width = `${rect.width}px`
          panel.style.height = `${rect.height}px`
        }
      }
    }
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(sync)
    resize?.observe(root)
    for (const group of groups) {
      const body = groupBodyRefs.current.get(group.id)
      if (body !== undefined) resize?.observe(body)
    }
    window.addEventListener('resize', sync)
    sync()
    return () => {
      resize?.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [groups, layoutVisible, reconciled.activeGroupId, reconciled.layout, sessionIds, surfaceStyle])

  const commit = (result: SessionLayoutResult): void => {
    actions.setLayout(result.layout, result.activeGroupId, result.nextGroup)
  }

  if (!layoutVisible && !layoutHasMounted.current) return null

  if (reconciled.layout === undefined) {
    if (!layoutVisible) return null
    return (
      <section className={css.root} style={surfaceStyle} data-docking-layout="">
        <div className={css.empty}>
          <strong>{t('empty.title')}</strong>
          <span>{t('empty.hint')}</span>
        </div>
      </section>
    )
  }

  const layout = reconciled.layout
  const groupCount = groups.length
  const openIds = new Set(sessionIds)
  const unopened = eligible.filter(id => !openIds.has(id))
  const remaining = new Set(unopened)
  const grouped = workspaceState.items.flatMap((workspace) => {
    const ids = workspace.sessionIds.filter(id => remaining.delete(id))
    return ids.length === 0
      ? []
      : [{ key: workspace.workspaceId as string, label: workspace.title, ids }]
  })
  const ungrouped = unopened.filter(id => remaining.has(id))
  const openGroups = ungrouped.length === 0
    ? grouped
    : [...grouped, { key: 'ungrouped', label: t('open.ungrouped'), ids: ungrouped }]
  const dragStart = (
    event: DragEvent<HTMLButtonElement>,
    groupId: string,
    sessionId: SessionId,
  ): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', sessionId)
    setDragged({ groupId, sessionId })
  }
  const dragOver = (event: DragEvent<HTMLElement>, groupId: string): void => {
    if (dragged === undefined) return
    const zone = resolveDropZone(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    const source = groups.find(group => group.id === dragged.groupId)
    const canDrop = source !== undefined && (
      zone === 'center'
      || dragged.groupId !== groupId
      || source.tabs.length > 1
    )
    if (!canDrop) {
      event.dataTransfer.dropEffect = 'none'
      setDropTarget(undefined)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(currentTarget => (
      currentTarget?.groupId === groupId && currentTarget.zone === zone
        ? currentTarget
        : { groupId, zone }
    ))
  }
  const drop = (event: DragEvent<HTMLElement>, targetGroupId: string): void => {
    event.preventDefault()
    if (dragged === undefined || dropTarget?.groupId !== targetGroupId) return
    const zone = dropTarget.zone
    const source = groups.find(group => group.id === dragged.groupId)
    if (
      zone !== 'center'
      && (
        source === undefined
        || (dragged.groupId === targetGroupId && source.tabs.length <= 1)
      )
    ) {
      setDragged(undefined)
      setDropTarget(undefined)
      return
    }
    commit(moveTab(
      layout, dragged.groupId, dragged.sessionId,
      targetGroupId, zone, reconciled.nextGroup,
    ))
    setDragged(undefined)
    setDropTarget(undefined)
  }

  const renderGroup = (
    group: SessionTabGroup,
    index: number,
    topRight: boolean,
  ): ReactNode => {
    const active = group.active
    const splitFallback = group.tabs.length <= 1 ? unopened[0] : undefined
    const split = (zone: 'right' | 'bottom'): void => {
      const source = splitFallback === undefined
        ? { layout, nextGroup: reconciled.nextGroup }
        : openTab(layout, group.id, splitFallback, reconciled.nextGroup)
      if (source.layout === undefined) return
      commit(splitTab(source.layout, group.id, active, zone, source.nextGroup))
    }
    const focusGroup = (event: PointerEvent<HTMLElement>): void => {
      const target = event.target as HTMLElement
      if (target.closest('[data-session-tab]') !== null) return
      if (reconciled.activeGroupId !== group.id) {
        actions.setLayout(layout, group.id, reconciled.nextGroup)
      }
    }
    return (
      <article
        key={group.id}
        id={`session-group-${group.id}`}
        className={css.group}
        data-active={group.id === reconciled.activeGroupId || undefined}
        data-docking-layout-active-group={group.id === reconciled.activeGroupId || undefined}
        data-docking-layout-top-right={topRight || undefined}
        aria-label={t('group.label', { index: index + 1 })}
        onPointerDownCapture={focusGroup}
        onDragOver={(event) => { dragOver(event, group.id) }}
        onDrop={(event) => { drop(event, group.id) }}
      >
        <div className={css.groupHeader} data-docking-layout-group-header="">
          <div className={css.tabs} role="tablist" aria-label={t('group.tabs', { index: index + 1 })}>
            {group.tabs.map((sessionId) => {
              const info = sessions.byId[sessionId]
              const title = info?.displayTitle ?? sessionId
              return (
                <div
                  key={sessionId}
                  className={css.tab}
                  data-selected={sessionId === active || undefined}
                  data-session-tab=""
                >
                  <button
                    className={css.tabLabel}
                    type="button"
                    role="tab"
                    draggable
                    aria-selected={sessionId === active}
                    aria-controls={`session-tabpanel-${group.id}-${sessionId}`}
                    title={`${title} · ${t('tab.dragHint')}`}
                    onClick={() => {
                      commit(activateTab(layout, group.id, sessionId, reconciled.nextGroup))
                    }}
                    onDragStart={(event) => { dragStart(event, group.id, sessionId) }}
                    onDragEnd={() => { setDragged(undefined); setDropTarget(undefined) }}
                  >
                    {info?.running === true ? <StateDot state="ongoing" size={9} /> : null}
                    <span>{title}</span>
                  </button>
                  <button
                    className={css.tabClose}
                    type="button"
                    aria-label={`${t('action.closeTab')}: ${title}`}
                    title={t('action.closeTab')}
                    disabled={pendingFinalClose !== undefined && sessionIds.length <= 1}
                    onClick={() => {
                      if (sessionIds.length <= 1) {
                        if (pendingFinalClose !== undefined) return
                        const request: PendingFinalClose = {
                          groupId: group.id,
                          outerCurrent: current,
                        }
                        setPendingFinalClose(request)
                        startSession((replacement) => {
                          setPendingFinalClose(pending => pending !== request
                            ? pending
                            : replacement === undefined
                              ? undefined
                              : { ...request, sessionId: replacement })
                        })
                        return
                      }
                      const result = closeTab(
                        layout, group.id, sessionId,
                        reconciled.activeGroupId, reconciled.nextGroup,
                      )
                      commit(result)
                    }}
                  >
                    <IconCloseFill14 size={12} />
                  </button>
                </div>
              )
            })}
          </div>

          <div className={css.groupActions} role="toolbar" aria-label={t('group.actions')}>
            <select
              className={css.openSelect}
              aria-label={t('action.openSession')}
              title={t('action.openSession')}
              value=""
              disabled={unopened.length === 0 || pendingFinalClose !== undefined}
              onChange={(event) => {
                const sessionId = event.currentTarget.value as SessionId
                if (sessionId !== '') {
                  commit(openTab(layout, group.id, sessionId, reconciled.nextGroup))
                }
              }}
            >
              <option value="">{t('action.openShort')}</option>
              {openGroups.map(group => (
                <optgroup key={group.key} label={group.label}>
                  {group.ids.map(sessionId => (
                    <option key={sessionId} value={sessionId}>
                      {sessions.byId[sessionId]?.displayTitle ?? sessionId}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              aria-label={t('action.splitRight')}
              title={t('action.splitRight')}
              disabled={
                (group.tabs.length <= 1 && splitFallback === undefined)
                || pendingFinalClose !== undefined
              }
              onClick={() => { split('right') }}
            >
              <IconChevronRightOutline14 />
            </button>
            <button
              type="button"
              aria-label={t('action.splitDown')}
              title={t('action.splitDown')}
              disabled={
                (group.tabs.length <= 1 && splitFallback === undefined)
                || pendingFinalClose !== undefined
              }
              onClick={() => { split('bottom') }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        </div>

        <div
          className={css.groupBody}
          ref={(element) => {
            if (element === null) groupBodyRefs.current.delete(group.id)
            else groupBodyRefs.current.set(group.id, element)
          }}
        />
        {dropTarget?.groupId === group.id ? (
          <div className={css.dropIndicator} data-zone={dropTarget.zone} aria-hidden="true" />
        ) : null}
      </article>
    )
  }

  let groupIndex = 0
  const renderLayout = (
    node: SessionLayoutNode,
    top = true,
    right = true,
  ): ReactNode => {
    if (node.kind === 'group') return renderGroup(node, groupIndex++, top && right)
    return (
      <div className={css.split} data-axis={node.axis}>
        {renderLayout(node.first, top, node.axis === 'vertical' && right)}
        <div className={css.divider} aria-hidden="true" />
        {renderLayout(node.second, node.axis === 'horizontal' && top, right)}
      </div>
    )
  }

  return (
    <section
      ref={rootRef}
      className={css.root}
      style={surfaceStyle}
      hidden={!layoutVisible}
      data-docking-layout=""
      data-group-count={groupCount}
      data-dragging={dragged !== undefined || undefined}
    >
      {groupCount > 1 ? (
        <nav className={css.groupSwitcher} aria-label={t('group.switcher')}>
          {groups.map((group, index) => (
            <button
              key={group.id}
              type="button"
              aria-label={t('group.switch', { index: index + 1 })}
              aria-pressed={group.id === reconciled.activeGroupId}
              onClick={() => {
                actions.setLayout(layout, group.id, reconciled.nextGroup)
              }}
            >
              {index + 1}
            </button>
          ))}
        </nav>
      ) : null}
      <div className={css.layout}>{renderLayout(layout)}</div>
      <div className={css.framePool}>
        {sessionIds.map((sessionId) => {
          const owner = groups.find(group => group.tabs.includes(sessionId))
          if (owner === undefined) return null
          return (
            <div
              key={sessionId}
              id={`session-tabpanel-${owner.id}-${sessionId}`}
              className={css.tabPanel}
              role="tabpanel"
              hidden={sessionId !== owner.active}
              data-group-active={owner.id === reconciled.activeGroupId || undefined}
              ref={(element) => {
                if (element === null) framePanelRefs.current.delete(sessionId)
                else framePanelRefs.current.set(sessionId, element)
              }}
            >
              {retainedFrameIdSet.has(sessionId) ? (
                <SessionFrame
                  sessionId={sessionId}
                  title={sessions.byId[sessionId]?.displayTitle ?? sessionId}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
