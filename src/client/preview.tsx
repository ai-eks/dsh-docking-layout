/** Persistent workspace sidebars, independent of conversation selection. */
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ISidebarRight, SidebarRightOpenResourceOptions, SidebarRightOpenTabOptions,
} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { followFrameSession, installFramePresentation, isMountedFrameMessage } from './frame.ts'
import css from './Preview.module.css'

export const PREVIEW_SESSION_PARAM = 'dsh-docking-preview'
export const PREVIEW_MESSAGE = 'dsh-docking-layout:preview'
export const BOTTOM_MESSAGE = 'dsh-docking-layout:bottom'
export const BOTTOM_SESSION_PARAM = 'dsh-docking-bottom'

export type PreviewCommand =
  | { action: 'resource'; address: string; options?: SidebarRightOpenResourceOptions }
  | { action: 'tab'; kind: string; options?: SidebarRightOpenTabOptions }
  | { action: 'show' }

interface PreviewState {
  available: boolean
  sessionId: SessionId | undefined
  sessionIds: SessionId[]
  pendingWorkspace: WorkspaceId | undefined
  error: string | undefined
  expanded: boolean
  fullscreen: boolean
}

/** Validate messages before dispatching them to the native Sidebar service. */
export function previewCommand(event: MessageEvent<unknown>, protocol = PREVIEW_MESSAGE): PreviewCommand | undefined {
  if (event.origin !== window.location.origin || typeof event.data !== 'object' || event.data === null) return
  const data = event.data as Record<string, unknown>
  if (data.type !== protocol) return
  if (data.action === 'show') return { action: 'show' }
  if (data.options !== undefined && (typeof data.options !== 'object' || data.options === null || Array.isArray(data.options))) return
  if (data.action === 'resource' && typeof data.address === 'string' && data.address.startsWith('dsh-resource://')) {
    return { action: 'resource', address: data.address, ...data.options === undefined ? {} : { options: data.options } }
  }
  if (data.action === 'tab' && typeof data.kind === 'string' && data.kind !== '') {
    return { action: 'tab', kind: data.kind, ...data.options === undefined ? {} : { options: data.options } }
  }
}

/** Route file links and the native expand button to the shared preview. */
export function forwardPreview(sidebar: ISidebarRight, send: (command: PreviewCommand) => void): () => void {
  const originalResource = sidebar.openResource
  const originalTab = sidebar.openTab
  const openResource: ISidebarRight['openResource'] = (address, options) => {
    send({ action: 'resource', address, ...options === undefined ? {} : { options } })
  }
  const openTab: ISidebarRight['openTab'] = (kind, options) => {
    send({ action: 'tab', kind, ...options === undefined ? {} : { options } })
  }
  sidebar.openResource = openResource
  sidebar.openTab = openTab
  const expand = (event: MouseEvent): void => {
    if (!(event.target instanceof Element) || event.target.closest('[data-sidebar-right-expand]') === null) return
    event.preventDefault()
    event.stopImmediatePropagation()
    send({ action: 'show' })
  }
  document.addEventListener('click', expand, true)
  return () => {
    if (sidebar.openResource === openResource) sidebar.openResource = originalResource
    if (sidebar.openTab === openTab) sidebar.openTab = originalTab
    document.removeEventListener('click', expand, true)
  }
}

/** Retain each visited workspace's native tabs and queue commands for its frame. */
export function createPreviewBridge(protocol = PREVIEW_MESSAGE, available = true) {
  const state = createSnapshotStore<PreviewState>({ available, sessionId: undefined, sessionIds: [], pendingWorkspace: undefined, error: undefined, expanded: false, fullscreen: false })
  const channels = new Map<SessionId, { frame: Window | null; ready: boolean; pending: PreviewCommand[] }>()
  let selection = 0
  const channelFor = (id: SessionId) => {
    let channel = channels.get(id)
    if (channel === undefined) {
      channel = { frame: null, ready: false, pending: [] }
      channels.set(id, channel)
    }
    return channel
  }
  const flush = (channel: ReturnType<typeof channelFor>): void => {
    if (!channel.ready || channel.frame === null) return
    for (const command of channel.pending.splice(0)) channel.frame.postMessage({ type: protocol, ...command }, window.location.origin)
  }
  const activate = (sessionId: SessionId): void => {
    const current = state.getSnapshot()
    state.set({ ...current, sessionId, pendingWorkspace: undefined, error: undefined,
      sessionIds: current.sessionIds.includes(sessionId) ? current.sessionIds : [...current.sessionIds, sessionId] })
  }
  const show = (command: PreviewCommand): void => {
    const current = state.getSnapshot()
    state.set({ ...current, expanded: true })
    if (current.sessionId === undefined) return
    const channel = channelFor(current.sessionId)
    channel.pending.push(command)
    flush(channel)
  }
  return {
    state,
    setAvailable(value: boolean) {
      if (!value) selection++
      state.set({ ...state.getSnapshot(), available: value, ...value ? {} : { expanded: false } })
    },
    selectSession(sessionId: SessionId | undefined) {
      if (state.getSnapshot().sessionId === undefined && sessionId !== undefined) activate(sessionId)
    },
    async chooseWorkspace(workspace: WorkspaceView, connect: (id: WorkspaceId) => Promise<SessionId>) {
      const request = ++selection
      const current = state.getSnapshot()
      state.set({ ...current, pendingWorkspace: workspace.workspaceId, error: undefined })
      try {
        const sessionId = current.sessionIds.find(id => workspace.sessionIds.includes(id))
          ?? workspace.sessionIds[0] ?? await connect(workspace.workspaceId)
        if (selection !== request) return
        activate(sessionId)
        show({ action: 'show' })
      } catch (error) {
        if (selection === request) state.set({ ...state.getSnapshot(), pendingWorkspace: undefined,
          error: error instanceof Error ? error.message : String(error) })
      }
    },
    bindFrame(sessionId: SessionId, next: Window | null) {
      const channel = channelFor(sessionId)
      if (channel.frame !== next) channel.ready = false
      channel.frame = next
    },
    receive(event: MessageEvent<unknown>) {
      if (event.origin !== window.location.origin) return
      for (const [sessionId, channel] of channels) {
        if (channel.frame === null || event.source !== channel.frame) continue
        if (typeof event.data !== 'object' || event.data === null) return
        const data = event.data as Record<string, unknown>
        if (data.type !== protocol) return
        if (data.action === 'ready') {
          channel.ready = true
          flush(channel)
        } else if (data.action === 'collapsed' && state.getSnapshot().sessionId === sessionId) {
          state.set({ ...state.getSnapshot(), expanded: false })
        }
        return
      }
      const fromBottom = protocol === PREVIEW_MESSAGE && Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-docking-bottom-frame]'))
        .some(frame => frame.contentWindow === event.source)
      if (!isMountedFrameMessage(event) && !fromBottom) return
      const command = previewCommand(event, protocol)
      if (command !== undefined) show(command)
    },
    show,
    close() { state.set({ ...state.getSnapshot(), expanded: false }) },
    toggleFullscreen() { state.set({ ...state.getSnapshot(), fullscreen: !state.getSnapshot().fullscreen }) },
    dispose() { selection++; channels.clear() },
  }
}

export type PreviewBridge = ReturnType<typeof createPreviewBridge>
export type PreviewInjected = {
  hooks: { preview: PreviewBridge['state'] }
  bridge: PreviewBridge
  connectWorkspace: (id: WorkspaceId) => Promise<SessionId>
  syncPresentation: (expanded: boolean, fullscreen: boolean, track: boolean) => void
}

export type PreviewProps = PropsRuntime<'rightbar'> & PropsLocale<'docking-layout'> & InjectFace<PreviewInjected>

/** Reflect the shared preview state in the outer tab bar. */
export function PreviewToggle({ bridge, t, panel = 'preview' }: { bridge: PreviewBridge; t: PreviewProps['t']; panel?: 'preview' | 'bottom' }): ReactNode {
  const state = useSyncExternalStore(bridge.state.subscribe, bridge.state.getSnapshot)
  if (!state.available) return null
  const label = t(state.expanded ? `${panel}.hideSidebar` : `${panel}.showSidebar`)
  return <button type="button" className={css.toggle} data-docking-preview-toggle={panel === 'preview' ? '' : undefined}
    data-docking-bottom-toggle={panel === 'bottom' ? '' : undefined} title={label} aria-label={label}
    aria-pressed={state.expanded} disabled={state.sessionId === undefined}
    onClick={() => { if (state.expanded) bridge.close(); else bridge.show({ action: 'show' }) }}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="12" rx="2" stroke="currentColor" />
      <path d={panel === 'bottom' ? 'M2 10h12' : 'M10 2v12'} stroke="currentColor" />
    </svg>
  </button>
}

/** Stable refs and URLs keep hidden workspaces' editors and terminals alive. */
function PreviewFrame({ bridge, sessionId, active, title, panel }: {
  bridge: PreviewBridge; sessionId: SessionId; active: boolean; title: string; panel: 'preview' | 'bottom'
}): ReactNode {
  const bindFrame = useCallback((element: HTMLIFrameElement | null) => {
    bridge.bindFrame(sessionId, element?.contentWindow ?? null)
  }, [bridge, sessionId])
  const src = useMemo(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('dsh-docking-session')
    url.searchParams.delete(PREVIEW_SESSION_PARAM)
    url.searchParams.delete(BOTTOM_SESSION_PARAM)
    url.searchParams.set(panel === 'bottom' ? BOTTOM_SESSION_PARAM : PREVIEW_SESSION_PARAM, sessionId)
    return url.toString()
  }, [sessionId, panel])
  return <iframe ref={bindFrame} src={src} title={title} className={css.frame}
    data-docking-preview-frame={panel === 'preview' ? sessionId : undefined}
    data-docking-bottom-frame={panel === 'bottom' ? sessionId : undefined} hidden={!active} />
}

/** Manual workspace selection is independent of the active conversation. */
export function SharedPreview({ usePreview, useWorkspaces, bridge, connectWorkspace, syncPresentation, width, viewportWidth, canShow, t, panel = 'preview', surfaceStyle, resizeHandle }: PreviewProps & {
  panel?: 'preview' | 'bottom'; surfaceStyle?: CSSProperties; resizeHandle?: ReactNode
}): ReactNode {
  const state = usePreview(value => value)
  const workspaces = useWorkspaces(value => value.items)
  const workspace = workspaces.find(item => state.sessionId !== undefined && item.sessionIds.includes(state.sessionId))
  const fullscreen = state.fullscreen || viewportWidth < 768 || !canShow
  const expanded = state.available && state.expanded && state.sessionId !== undefined
  useLayoutEffect(() => {
    syncPresentation(expanded, fullscreen, viewportWidth >= 768 && canShow)
  }, [canShow, expanded, fullscreen, syncPresentation, viewportWidth])
  useLayoutEffect(() => () => { syncPresentation(false, false, false) }, [syncPresentation])
  if (!state.available || state.sessionId === undefined) return null
  return (
    <aside
      className={css.root}
      data-docking-shared-preview={panel === 'preview' ? '' : undefined}
      data-docking-shared-bottom={panel === 'bottom' ? '' : undefined}
      data-fullscreen={fullscreen || undefined}
      hidden={!expanded}
      style={{ width: fullscreen ? '100%' : width, ...fullscreen ? {} : surfaceStyle }}
      aria-label={t(`${panel}.title`)}
    >
      {!fullscreen && resizeHandle}
      <div className={css.toolbar}>
        <label className={css.workspace}>
          <span>{t(`${panel}.workspace`)}</span>
          <select aria-label={t(`${panel}.workspace`)} title={workspace?.path}
            value={workspace?.workspaceId ?? ''} disabled={state.pendingWorkspace !== undefined}
            onChange={event => {
              const next = workspaces.find(item => item.workspaceId === event.target.value)
              if (next !== undefined) void bridge.chooseWorkspace(next, connectWorkspace)
            }}>
            {workspace === undefined && <option value="">{t(`${panel}.chooseWorkspace`)}</option>}
            {workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}
          </select>
        </label>
        <div className={css.actions}>
          <button type="button" title={t(fullscreen ? `${panel}.restore` : `${panel}.fullscreen`)}
            aria-label={t(fullscreen ? `${panel}.restore` : `${panel}.fullscreen`)}
            onClick={() => { if (viewportWidth < 768 || !canShow) bridge.close(); else bridge.toggleFullscreen() }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d={fullscreen ? 'M6 1v5H1m14 4h-5v5' : 'M1 6V1h5m4 14h5v-5'} stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          <button type="button" title={t(`${panel}.close`)} aria-label={t(`${panel}.close`)} onClick={bridge.close}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.5" y="2" width="13" height="12" rx="2" stroke="currentColor" />
              <path d={panel === 'bottom' ? 'M2 10h12' : 'M10 2v12'} stroke="currentColor" />
            </svg>
          </button>
        </div>
      </div>
      {state.pendingWorkspace !== undefined && <div className={css.status} role="status">{t(`${panel}.connecting`)}</div>}
      {state.error !== undefined && <div className={css.status} role="alert">{t(`${panel}.connectFailed`)}: {state.error}</div>}
      <div className={css.content}>
        {state.sessionIds.map(id => <PreviewFrame key={id} bridge={bridge} sessionId={id}
          active={state.sessionId === id} panel={panel} title={t(`${panel}.title`)} />)}
      </div>
    </aside>
  )
}

/** Replace the outer rightbar seat; native implementations keep their fixed owners. */
export function installSharedPreview(ctx: Context): PreviewBridge {
  const bridge = createPreviewBridge()
  ctx.effect(() => {
    const select = (): void => { bridge.selectSession(ctx.sessions.list.getSnapshot().current) }
    const unsubscribe = ctx.sessions.list.subscribe(select)
    select()
    window.addEventListener('message', bridge.receive)
    const restore = forwardPreview(ctx.sidebarRight, bridge.show)
    return () => {
      restore()
      bridge.dispose()
      unsubscribe()
      window.removeEventListener('message', bridge.receive)
    }
  }, 'docking-layout: shared preview bridge')
  ctx.slots.inject('rightbar', () => ctx.slots.register({
    name: 'rightbar', priority: -10, locale: 'docking-layout',
    inject: (): PreviewInjected => ({
      hooks: { preview: bridge.state }, bridge,
      connectWorkspace: id => ctx.uiWorkspace.connectWorkspace(id),
      syncPresentation(expanded, fullscreen, track) {
        if (expanded) ctx.layout.openRightbar(track, fullscreen)
        else ctx.layout.closeRightbar()
      },
    }),
  }, SharedPreview))
  return bridge
}

/** Mount the native Sidebar once, with one fixed Session as its lifetime owner. */
export function installPreviewFrame(ctx: Context, sessionId: SessionId): () => void {
  const stopFollowing = followFrameSession(ctx.sessions, sessionId, () => {})
  const removeFrame = installFramePresentation()
  document.body.setAttribute('data-dsh-docking-preview', '')
  const style = document.createElement('style')
  style.textContent = `
body[data-dsh-docking-preview] [data-dsh-docking-frame-shell] { grid-template-columns: 0 0 minmax(0, 1fr) !important; }
body[data-dsh-docking-preview] [data-dsh-panel-host] { visibility: hidden !important; pointer-events: none !important; }
body[data-dsh-docking-preview] [data-dsh-docking-frame-conversation] { display: none !important; }
body[data-dsh-docking-preview] [data-dsh-docking-frame-rightbar] { display: block !important; grid-column: 3; grid-row: 1; }
body[data-dsh-docking-preview] [data-sidebar-right-panel] { position: fixed !important; inset: 0 !important; width: 100% !important; transform: none !important; visibility: visible !important; }
body[data-dsh-docking-preview] [data-sidebar-right-mode], body[data-dsh-docking-preview] [data-sidebar-right-toggle] { visibility: hidden !important; }
`
  document.head.append(style)
  const receive = (event: MessageEvent<unknown>): void => {
    if (event.source !== window.parent) return
    const command = previewCommand(event)
    if (command?.action === 'resource') ctx.sidebarRight.openResource(command.address, command.options)
    else if (command?.action === 'tab') ctx.sidebarRight.openTab(command.kind, command.options)
    else if (command?.action === 'show' && !ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
  }
  window.addEventListener('message', receive)
  let raf: number
  let initialized = false
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target as Element).hasAttribute('data-sidebar-right-open'))) {
      window.parent.postMessage({ type: PREVIEW_MESSAGE, action: 'collapsed' }, window.location.origin)
    }
  })
  const announce = (): void => {
    // A collapsed native surface starts empty; its own control seeds the default
    // page without racing the service binding published by React's effect.
    const toggle = document.querySelector<HTMLButtonElement>('[data-sidebar-right-toggle]')
    if (!initialized && toggle !== null) {
      initialized = true
      if (!ctx.sidebarRight.isExpanded()) toggle.click()
    }
    if (ctx.sidebarRight.active() === undefined) {
      raf = requestAnimationFrame(announce)
      return
    }
    const panel = document.querySelector('[data-sidebar-right-panel]')
    if (panel !== null) observer.observe(panel, { attributes: true, attributeFilter: ['data-sidebar-right-open'] })
    window.parent.postMessage({ type: PREVIEW_MESSAGE, action: 'ready' }, window.location.origin)
  }
  raf = requestAnimationFrame(announce)
  return () => {
    cancelAnimationFrame(raf)
    observer.disconnect()
    window.removeEventListener('message', receive)
    stopFollowing()
    removeFrame()
    style.remove()
    document.body.removeAttribute('data-dsh-docking-preview')
  }
}
