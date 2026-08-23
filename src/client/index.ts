/** Browser plugin that overlays stock DSH with dockable, same-origin Session frames. */
import type {
  ClientContext, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DockingLayout, DockingLayoutFooterAction } from './DockingLayout.tsx'
import {
  followFrameSession, frameSessionId, installFramePresentation, isFrameNavigateMessage,
  isFrameReadyMessage, isFrameToggleSidebarMessage, isMountedFrameMessage,
} from './frame.ts'
import { createDockingLayoutStore } from './stores.ts'
import { en, zh, type DockingLayoutKey } from './locales.ts'

export { DockingLayout, DockingLayoutFooterAction } from './DockingLayout.tsx'
export type {
  DockingLayoutFooterActionProps, DockingLayoutProps,
} from './DockingLayout.tsx'
export {
  MIN_GROUP_HEIGHT, MIN_GROUP_WIDTH, SPLIT_DIVIDER_SIZE,
  activateTab, canSplitBounds, closeTab, collectGroups, collectSessionIds, moveTab, openTab,
  reconcileSessionLayout, replaceTab, resolveDropZone, sameLayout, splitTab,
} from './layout.ts'
export type {
  DropZone, SessionLayoutNode, SessionLayoutResult, SessionSplit, SessionTabGroup,
} from './layout.ts'
export type { DockingLayoutState } from './stores.ts'
export {
  FRAME_FOCUS_MESSAGE, FRAME_NAVIGATE_MESSAGE, FRAME_READY_MESSAGE, FRAME_SESSION_PARAM,
  followFrameSession,
  FRAME_TOGGLE_SIDEBAR_MESSAGE, frameSessionId, installFramePresentation,
  isFrameFocusMessage, isFrameNavigateMessage, isFrameReadyMessage,
  isFrameToggleSidebarMessage, isMountedFrameMessage, sessionFrameUrl,
} from './frame.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session tab, editor-group, drag target, and empty-state copy. */
    'docking-layout': DockingLayoutKey
  }
}

const NS = 'docking-layout'

/** Services required by the browser-only layout overlay. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'layout']

/**
 * Register Docking Layout over the stock conversation column.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const addressedSession = frameSessionId()
  if (addressedSession !== undefined) {
    ctx.effect(installFramePresentation, 'docking-layout: embedded frame presentation')
    ctx.effect(
      () => followFrameSession(ctx.sessions, addressedSession),
      'docking-layout: embedded frame Session selection',
    )
    return
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'docking-layout: dictionaries')
  const store = createDockingLayoutStore()
  ctx.effect(() => {
    let pendingNavigation: SessionId | undefined
    let requestedPhase: SessionListState['phase'] | undefined
    let requestedCurrent: SessionId | undefined
    const openPendingNavigation = (): void => {
      if (pendingNavigation === undefined) return
      const sessions = ctx.sessions.list.getSnapshot()
      if (sessions.current === pendingNavigation) {
        pendingNavigation = undefined
        requestedPhase = undefined
        requestedCurrent = undefined
        return
      }
      if (sessions.byId[pendingNavigation] === undefined) return
      if (requestedPhase === sessions.phase && requestedCurrent === sessions.current) return
      requestedPhase = sessions.phase
      requestedCurrent = sessions.current
      ctx.sessions.open(pendingNavigation)
    }
    const handleFrameMessage = (event: MessageEvent<unknown>): void => {
      if (isFrameNavigateMessage(event)) {
        if (!isMountedFrameMessage(event, event.data.sourceSessionId)) return
        pendingNavigation = event.data.sessionId
        requestedPhase = undefined
        requestedCurrent = undefined
        openPendingNavigation()
        return
      }
      if (isFrameToggleSidebarMessage(event)) {
        if (!isMountedFrameMessage(event)) return
        ctx.layout.toggleSidebar()
        return
      }
      if (!isFrameReadyMessage(event)) return
      if (!isMountedFrameMessage(event, event.data.sessionId)) return
      const current = ctx.sessions.list.getSnapshot().current
      if (current !== undefined) ctx.sessions.open(current)
    }
    const unsubscribe = ctx.sessions.list.subscribe(openPendingNavigation)
    window.addEventListener('message', handleFrameMessage)
    return () => {
      unsubscribe()
      window.removeEventListener('message', handleFrameMessage)
    }
  }, 'docking-layout: bridge embedded navigation')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'docking-layout',
    order: 10,
    locale: NS,
    store,
    inject: () => ({ startSession: () => { ctx.workspaces.startSession() } }),
  }, DockingLayout))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'docking-layout',
    order: 10,
    locale: NS,
    store,
  }, DockingLayoutFooterAction))
}
