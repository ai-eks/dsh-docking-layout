/** Browser plugin that overlays stock DSH with dockable, same-origin Session frames. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DockingLayout, DockingLayoutFooterAction } from './DockingLayout.tsx'
import {
  followFrameSession, frameSessionId, installFramePresentation, isFrameNavigateMessage,
  isFrameReadyMessage, isFrameToggleSidebarMessage, isMountedFrameMessage,
} from './frame.ts'
import { createDockingLayoutStore } from './stores.ts'
import { en, zh, type DockingLayoutKey } from './locales.ts'
import { forwardPreview, installPreviewFrame, installSharedPreview, PREVIEW_MESSAGE, PREVIEW_SESSION_PARAM } from './preview.tsx'
import { installWorkspaceFiles } from './workspace-files.tsx'

/** Retain client service augmentations in published declarations. */
export type {} from '@deepseek-ai/dsh-client-locale/client'
export type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export { DockingLayout, DockingLayoutFooterAction } from './DockingLayout.tsx'
export type {
  DockingLayoutFooterActionProps, DockingLayoutProps,
} from './DockingLayout.tsx'
export {
  activateTab, closeTab, collectGroups, collectSessionIds, moveTab, openTab,
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
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale', 'layout', 'sidebarRight']

/**
 * Register Docking Layout over the stock conversation column.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const previewSession = window.parent !== window
    ? new URL(window.location.href).searchParams.get(PREVIEW_SESSION_PARAM)
    : null
  if (previewSession) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'docking-layout: preview dictionaries')
    ctx.inject(['remote', 'remote.workspaceFiles'], installWorkspaceFiles)
    ctx.effect(() => installPreviewFrame(ctx, previewSession as SessionId), 'docking-layout: persistent preview frame')
    return
  }
  const addressedSession = frameSessionId()
  if (addressedSession !== undefined) {
    ctx.effect(installFramePresentation, 'docking-layout: embedded frame presentation')
    ctx.effect(
      () => followFrameSession(ctx.sessions, addressedSession),
      'docking-layout: embedded frame Session selection',
    )
    ctx.effect(() => forwardPreview(ctx.sidebarRight, command => {
      window.parent.postMessage({ type: PREVIEW_MESSAGE, ...command }, window.location.origin)
    }), 'docking-layout: forward embedded file previews')
    return
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'docking-layout: dictionaries')
  const preview = installSharedPreview(ctx)
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
      ctx.uiWorkspace.openSession(pendingNavigation)
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
    inject: () => ({
      preview,
      startSession: (onStarted: (sessionId: SessionId | undefined) => void) => {
        const sessions = ctx.sessions.list.getSnapshot()
        const workspaces = ctx.workspaces.list.getSnapshot()
        let target = workspaces.items.find(item => (
          sessions.current !== undefined && item.sessionIds.includes(sessions.current)
        ))?.workspaceId
        // Preserve DSH's current-or-most-recent Workspace selection policy.
        if (target === undefined && sessions.phase === 'ready' && workspaces.phase === 'ready') {
          let latest = Number.NEGATIVE_INFINITY
          for (const workspace of workspaces.items) {
            let updatedAt = workspace.sessionIds.reduce((time, id) => (
              Math.max(time, sessions.byId[id]?.updatedAt ?? Number.NEGATIVE_INFINITY)
            ), Number.NEGATIVE_INFINITY)
            if (updatedAt === Number.NEGATIVE_INFINITY) updatedAt = Date.parse(workspace.createdAt)
            if (target === undefined || updatedAt > latest) {
              target = workspace.workspaceId
              latest = updatedAt
            }
          }
        }
        if (target === undefined) {
          onStarted(undefined)
          ctx.sessions.clear()
          ctx.layout.selectPanel(null)
          return
        }
        // startSession() returns void; connectWorkspace() identifies this exact result.
        const navigation = ctx.layout.beginNavigation()
        ctx.uiWorkspace.connectWorkspace(target).then((sessionId) => {
          if (navigation.aborted) {
            onStarted(undefined)
            return
          }
          onStarted(sessionId)
          ctx.uiWorkspace.openSession(sessionId)
        }, (reason: unknown) => {
          onStarted(undefined)
          console.warn('new session failed:', reason)
        })
      },
    }),
  }, DockingLayout))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'docking-layout',
    order: 10,
    locale: NS,
    store,
  }, DockingLayoutFooterAction))
}
