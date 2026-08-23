/** Browser plugin that overlays stock DSH with dockable, same-origin Session frames. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DockingLayout, DockingLayoutFooterAction } from './DockingLayout.tsx'
import {
  followFrameSession, frameSessionId, installFramePresentation, isFrameNavigateMessage,
  isFrameReadyMessage, isFrameToggleSidebarMessage,
} from './frame.ts'
import { createDockingLayoutStore } from './stores.ts'
import { en, zh, type DockingLayoutKey } from './locales.ts'

export { DockingLayout, DockingLayoutFooterAction } from './DockingLayout.tsx'
export type {
  DockingLayoutFooterActionProps, DockingLayoutProps,
} from './DockingLayout.tsx'
export {
  MAX_GROUPS, activateTab, closeGroup, closeTab, collectGroups, collectSessionIds,
  moveTab, openTab, reconcileSessionLayout, resolveDropZone, sameLayout, splitTab,
} from './layout.ts'
export type {
  DropZone, SessionLayoutNode, SessionLayoutResult, SessionSplit, SessionTabGroup,
} from './layout.ts'
export type { DockingLayoutState } from './stores.ts'
export {
  FRAME_NAVIGATE_MESSAGE, FRAME_READY_MESSAGE, FRAME_SESSION_PARAM, followFrameSession,
  FRAME_TOGGLE_SIDEBAR_MESSAGE, frameSessionId, installFramePresentation,
  isFrameNavigateMessage, isFrameReadyMessage, isFrameToggleSidebarMessage, sessionFrameUrl,
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
    const handleFrameMessage = (event: MessageEvent<unknown>): void => {
      if (isFrameNavigateMessage(event)) {
        const sessions = ctx.sessions.list.getSnapshot()
        if (sessions.byId[event.data.sessionId] !== undefined) {
          ctx.sessions.open(event.data.sessionId)
        }
        return
      }
      if (isFrameToggleSidebarMessage(event)) {
        ctx.layout.toggleSidebar()
        return
      }
      if (!isFrameReadyMessage(event)) return
      const current = ctx.sessions.list.getSnapshot().current
      if (current !== undefined) ctx.sessions.open(current)
    }
    window.addEventListener('message', handleFrameMessage)
    return () => { window.removeEventListener('message', handleFrameMessage) }
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
