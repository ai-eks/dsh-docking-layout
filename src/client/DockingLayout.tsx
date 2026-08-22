/** VS Code-style Session tabs and drag-to-split conversation groups. */
import {
  useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent,
  type PointerEvent, type ReactNode,
} from 'react'
import type {
  PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconCloseFill14,
  IconCloseOutline16, IconPanelLeftOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { createDockingLayoutStore } from './stores.ts'
import {
  MAX_GROUPS, activateTab, closeGroup, closeTab, collectGroups, collectSessionIds,
  moveTab, openTab, reconcileSessionLayout, resolveDropZone, sameLayout, splitTab,
  type DropZone, type SessionLayoutNode, type SessionLayoutResult, type SessionTabGroup,
} from './layout.ts'
import { sessionFrameUrl } from './frame.ts'
import css from './DockingLayout.module.css'

/** Complete props of the root-scoped Docking Layout overlay. */
export type DockingLayoutProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createDockingLayoutStore>>
  & PropsLocale<'docking-layout'>

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

const UNSEEN_NAVIGATION = Symbol('unseen navigation')

interface SurfaceBounds {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

function equalBounds(left: SurfaceBounds | undefined, right: SurfaceBounds): boolean {
  return left?.left === right.left && left.top === right.top
    && left.width === right.width && left.height === right.height
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
      discovery?.disconnect()
      const rect = nextObserved.getBoundingClientRect()
      const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      setBounds(current => equalBounds(current, next) ? current : next)
    }
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    discovery = new MutationObserver(measure)
    discovery.observe(document.documentElement, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    measure()
    return () => {
      resize?.disconnect()
      discovery?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return bounds === undefined
    ? { visibility: 'hidden' }
    : { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
}

/**
 * Keep the disabled-layout entry point in the persistent DSH sidebar footer.
 * @param props - sidebar width state and the shared root layout store.
 * @returns the open action, or null while Docking Layout is active.
 */
export function DockingLayoutFooterAction({
  wide, useStore, actions, t,
}: DockingLayoutFooterActionProps): ReactNode {
  const enabled = useStore(state => state.enabled)
  if (enabled) return null
  return (
    <button
      className={css.footerAction}
      data-wide={wide || undefined}
      type="button"
      aria-label={t('action.open')}
      title={t('action.open')}
      onClick={() => { actions.setEnabled(true) }}
    >
      <IconPanelLeftOutline16 size={wide ? 16 : 18} />
      {wide ? <span>{t('action.open')}</span> : null}
    </button>
  )
}

/**
 * Render Session tabs and recursive editor groups over native conversation panes.
 * @param props - layout owner, live Session list, preference store, and runtime actions.
 * @returns the current single-pane or tabbed workbench layout.
 */
export function DockingLayout({
  useSessions, useStore, actions, useWorkspaces, t,
}: DockingLayoutProps): ReactNode {
  const sessions = useSessions(state => state)
  const current = sessions.current
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const grid = useStore(state => state)
  const surfaceStyle = useConversationSurface()
  const previousNavigation = useRef<SessionId | undefined | typeof UNSEEN_NAVIGATION>(
    UNSEEN_NAVIGATION,
  )
  const [dragged, setDragged] = useState<DraggedTab>()
  const [dropTarget, setDropTarget] = useState<DropTarget>()
  const archived = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const eligible = useMemo(
    () => sessions.ids.filter(id => sessions.byId[id]?.blank === false && !archived.has(id)),
    [archived, sessions],
  )
  const reconciled = useMemo(
    () => reconcileSessionLayout(
      grid.layout, eligible, current, grid.activeGroupId, grid.nextGroup,
      previousNavigation.current !== current,
    ),
    [current, eligible, grid.activeGroupId, grid.layout, grid.nextGroup],
  )
  const sessionIds = useMemo(() => collectSessionIds(reconciled.layout), [reconciled.layout])
  const groups = useMemo(() => collectGroups(reconciled.layout), [reconciled.layout])
  const currentIsBlank = current === undefined || sessions.byId[current]?.blank !== false
  const persistedMatches = sameLayout(grid.layout, reconciled.layout)
    && grid.activeGroupId === reconciled.activeGroupId
    && grid.nextGroup === reconciled.nextGroup

  useEffect(() => {
    previousNavigation.current = current
  }, [current])

  useEffect(() => {
    if (!persistedMatches) {
      actions.setLayout(reconciled.layout, reconciled.activeGroupId, reconciled.nextGroup)
    }
  }, [actions, persistedMatches, reconciled])

  const commit = (result: SessionLayoutResult): void => {
    actions.setLayout(result.layout, result.activeGroupId, result.nextGroup)
  }

  if (!grid.enabled || currentIsBlank) return null

  if (reconciled.layout === undefined) {
    return (
      <section className={css.root} style={surfaceStyle} data-docking-layout="">
        <div className={css.emptyActions}>
          <button type="button" onClick={() => { actions.setEnabled(false) }}>{t('action.single')}</button>
        </div>
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
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const zone = resolveDropZone(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    setDropTarget(currentTarget => (
      currentTarget?.groupId === groupId && currentTarget.zone === zone
        ? currentTarget
        : { groupId, zone }
    ))
  }
  const drop = (event: DragEvent<HTMLElement>, targetGroupId: string): void => {
    event.preventDefault()
    if (dragged === undefined) return
    const zone = dropTarget?.groupId === targetGroupId ? dropTarget.zone : 'center'
    commit(moveTab(
      layout, dragged.groupId, dragged.sessionId,
      targetGroupId, zone, reconciled.nextGroup,
    ))
    setDragged(undefined)
    setDropTarget(undefined)
  }

  const renderGroup = (group: SessionTabGroup, index: number): ReactNode => {
    const active = group.active
    const splitDisabled = group.tabs.length <= 1 || groupCount >= MAX_GROUPS
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
        data-mobile-active={group.id === reconciled.activeGroupId || undefined}
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
                    disabled={sessionIds.length <= 1}
                    onClick={() => {
                      const result = closeTab(
                        layout, group.id, sessionId, reconciled.nextGroup,
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
              disabled={unopened.length === 0}
              onChange={(event) => {
                const sessionId = event.currentTarget.value as SessionId
                if (sessionId !== '') {
                  commit(openTab(layout, group.id, sessionId, reconciled.nextGroup))
                }
              }}
            >
              <option value="">{t('action.openShort')}</option>
              {unopened.map(sessionId => (
                <option key={sessionId} value={sessionId}>
                  {sessions.byId[sessionId]?.displayTitle ?? sessionId}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={t('action.splitRight')}
              title={t('action.splitRight')}
              disabled={splitDisabled}
              onClick={() => {
                commit(splitTab(
                  layout, group.id, active, 'right', reconciled.nextGroup,
                ))
              }}
            >
              <IconChevronRightOutline14 />
            </button>
            <button
              type="button"
              aria-label={t('action.splitDown')}
              title={t('action.splitDown')}
              disabled={splitDisabled}
              onClick={() => {
                commit(splitTab(
                  layout, group.id, active, 'bottom', reconciled.nextGroup,
                ))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
            <button
              type="button"
              aria-label={t('action.closeGroup')}
              title={t('action.closeGroup')}
              disabled={groupCount <= 1}
              onClick={() => {
                const result = closeGroup(layout, group.id, reconciled.nextGroup)
                commit(result)
              }}
            >
              <IconCloseOutline16 size={14} />
            </button>
            <button
              type="button"
              aria-label={t('action.single')}
              title={t('action.single')}
              onClick={() => { actions.setEnabled(false) }}
            >
              <IconPanelLeftOutline16 size={14} />
            </button>
          </div>
        </div>

        <div className={css.groupBody}>
          {group.tabs.map(sessionId => (
            <div
              key={sessionId}
              id={`session-tabpanel-${group.id}-${sessionId}`}
              className={css.tabPanel}
              role="tabpanel"
              hidden={sessionId !== active}
            >
              <iframe
                className={css.sessionFrame}
                src={sessionFrameUrl(sessionId)}
                title={sessions.byId[sessionId]?.displayTitle ?? sessionId}
                allow="clipboard-read; clipboard-write"
                referrerPolicy="same-origin"
              />
            </div>
          ))}
        </div>
        {dropTarget?.groupId === group.id ? (
          <div className={css.dropIndicator} data-zone={dropTarget.zone} aria-hidden="true" />
        ) : null}
      </article>
    )
  }

  let groupIndex = 0
  const renderLayout = (node: SessionLayoutNode): ReactNode => {
    if (node.kind === 'group') return renderGroup(node, groupIndex++)
    return (
      <div className={css.split} data-axis={node.axis}>
        {renderLayout(node.first)}
        <div className={css.divider} aria-hidden="true" />
        {renderLayout(node.second)}
      </div>
    )
  }

  return (
    <section
      className={css.root}
      style={surfaceStyle}
      data-docking-layout=""
      data-group-count={groupCount}
    >
      <div
        className={css.mobileGroups}
        role="tablist"
        aria-label={t('mobile.groups')}
        data-docking-layout-mobile-groups=""
      >
        {groups.map((group, index) => {
          const title = sessions.byId[group.active]?.displayTitle ?? group.active
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={group.id === reconciled.activeGroupId}
              aria-controls={`session-group-${group.id}`}
              onClick={() => {
                commit(activateTab(
                  layout, group.id, group.active, reconciled.nextGroup,
                ))
              }}
            >
              <span>{index + 1}</span>
              {title}
            </button>
          )
        })}
      </div>
      <div className={css.layout}>{renderLayout(layout)}</div>
    </section>
  )
}
