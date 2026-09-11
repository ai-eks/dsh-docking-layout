/** A global, workspace-owned better-sidebar workbench below the conversation area. */
import { useCallback, useRef, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { followFrameSession, installFramePresentation } from './frame.ts'
import { useConversationSurface } from './DockingLayout.tsx'
import {
  BOTTOM_MESSAGE, createPreviewBridge, forwardPreview, PREVIEW_MESSAGE, previewCommand,
  PreviewToggle, SharedPreview, type PreviewBridge, type PreviewInjected,
} from './preview.tsx'
import css from './Preview.module.css'

/** Only the public state subscription contract of the optional companion plugin. */
interface BottomService {
  getSnapshot(): { sessionId: string | undefined; state: { bottomOpen: boolean } | undefined }
  subscribeState(listener: () => void): () => void
}

const PROXY_STYLE = `
body[data-dsh-docking-bottom-proxy] [data-dsh-panel-host] { visibility: hidden !important; pointer-events: none !important; }
body[data-dsh-docking-bottom-proxy] [data-dsh-bottom-toggle] { display: none !important; }
body[data-dsh-docking-bottom-proxy]:not([data-dsh-docking-bottom-host]) [data-dsh-center-col] { margin-bottom: 0 !important; }
body[data-dsh-docking-bottom-host] [data-dsh-center-col] { margin-bottom: var(--docking-bottom-height, 0px) !important; transition: none !important; }
`

/** Remove local copies while keeping a single outer control for the workbench. */
export function installBottomProxy(send: () => void): () => void {
  document.body.setAttribute('data-dsh-docking-bottom-proxy', '')
  const style = document.createElement('style')
  style.textContent = PROXY_STYLE
  document.head.append(style)
  const click = (event: MouseEvent): void => {
    if (!(event.target instanceof Element) || event.target.closest('[data-dsh-bottom-toggle]') === null) return
    event.preventDefault()
    event.stopImmediatePropagation()
    send()
  }
  document.addEventListener('click', click, true)
  return () => {
    document.removeEventListener('click', click, true)
    document.body.removeAttribute('data-dsh-docking-bottom-proxy')
    style.remove()
  }
}

type BottomProps = PropsRuntime<'shell.overlay'> & PropsLocale<'docking-layout'> & InjectFace<PreviewInjected>

/** Resize the outer container; each workspace's mounted client keeps its own tabs. */
export function SharedBottom(props: BottomProps): ReactNode {
  const surface = useConversationSurface()
  const [requestedHeight, setHeight] = useState(280)
  const drag = useRef({ y: 0, height: 0 })
  const maxHeight = Math.max(120, Math.floor(window.innerHeight * 0.6))
  const height = Math.min(requestedHeight, maxHeight)
  const resize = (next: number): void => { setHeight(Math.max(120, Math.min(maxHeight, next))) }
  // The native main column is outside React's docking overlay. Its margin is
  // the shared source of geometry for both the overlay and the bottom panel.
  const syncPresentation = useCallback((expanded: boolean, fullscreen: boolean): void => {
    document.documentElement.style.setProperty('--docking-bottom-height', expanded && !fullscreen ? `${height}px` : '0px')
  }, [height])
  return <SharedPreview {...props} panel="bottom" width={Number(surface.width) || 0}
    viewportWidth={window.innerWidth} canShow={true} syncPresentation={syncPresentation}
    surfaceStyle={{ position: 'fixed', left: surface.left, top: 'auto', bottom: 0, height, visibility: surface.visibility }}
    resizeHandle={<div className={css.resize} role="separator" aria-label={props.t('bottom.resize')}
      aria-orientation="horizontal" aria-valuemin={120} aria-valuemax={maxHeight} aria-valuenow={height} tabIndex={0}
      onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        resize(height + (event.key === 'ArrowUp' ? 20 : -20))
      }}
      onPointerDown={event => {
        event.preventDefault()
        drag.current = { y: event.clientY, height }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(drag.current.height + drag.current.y - event.clientY)
      }}
      onPointerUp={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        resize(drag.current.height + drag.current.y - event.clientY)
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    />} />
}

/** Activate only when better-sidebar is installed; right-sidebar use needs no companion plugin. */
export function installSharedBottom(ctx: Context): PreviewBridge {
  const bridge = createPreviewBridge(BOTTOM_MESSAGE, false)
  ctx.effect(() => {
    const select = (): void => { bridge.selectSession(ctx.sessions.list.getSnapshot().current) }
    const unsubscribe = ctx.sessions.list.subscribe(select)
    select()
    window.addEventListener('message', bridge.receive)
    return () => {
      unsubscribe()
      window.removeEventListener('message', bridge.receive)
      bridge.dispose()
    }
  }, 'docking-layout: shared bottom bridge')
  ctx.inject(['betterSidebar' as never], scope => {
    scope.effect(() => {
      document.body.setAttribute('data-dsh-docking-bottom-host', '')
      const removeProxy = installBottomProxy(() => bridge.show({ action: 'show' }))
      bridge.setAvailable(true)
      return () => {
        bridge.setAvailable(false)
        removeProxy()
        document.body.removeAttribute('data-dsh-docking-bottom-host')
        document.documentElement.style.removeProperty('--docking-bottom-height')
      }
    }, 'docking-layout: global bottom presentation')
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'docking-layout-bottom', order: 11, locale: 'docking-layout',
      inject: (): PreviewInjected => ({ bridge, hooks: { preview: bridge.state },
        connectWorkspace: id => scope.uiWorkspace.connectWorkspace(id), syncPresentation: () => {} }),
    }, SharedBottom))
    scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities', id: 'docking-layout:bottom-toggle', order: 10, locale: 'docking-layout',
      inject: () => ({ bridge }),
    }, props => <PreviewToggle bridge={props.bridge} t={props.t} panel="bottom" />))
  })
  return bridge
}

/** Show only the fixed owner's native bottom workbench inside this frame. */
export function installBottomFrame(ctx: Context, service: BottomService, sessionId: SessionId): () => void {
  const stopFollowing = followFrameSession(ctx.sessions, sessionId, () => {})
  const removeFrame = installFramePresentation()
  const restorePreview = forwardPreview(ctx.sidebarRight, command => {
    window.parent.postMessage({ type: PREVIEW_MESSAGE, ...command }, window.location.origin)
  })
  document.body.setAttribute('data-dsh-docking-bottom-client', '')
  const style = document.createElement('style')
  style.textContent = `
body[data-dsh-docking-bottom-client] [data-dsh-docking-frame-conversation] { visibility: hidden !important; margin-bottom: 0 !important; }
body[data-dsh-docking-bottom-client] [data-dsh-bottom-panel] { inset: 0 !important; height: 100% !important; visibility: visible !important; transform: none !important; transition: none !important; }
body[data-dsh-docking-bottom-client] [data-dsh-bottom-panel] > div:first-child { display: none; }
`
  document.head.append(style)
  let announced = false
  let wasOpen = false
  let raf: number | undefined
  // Blank sessions have no conversation header. The workbench's own close
  // button uses the same native toggle action and is mounted in that case too.
  const nativeToggle = (): HTMLButtonElement | null => document.querySelector(
    '[data-dsh-bottom-toggle], [data-dsh-bottom-panel] > button',
  )
  const update = (): void => {
    const snapshot = service.getSnapshot()
    if (snapshot.sessionId !== sessionId || snapshot.state === undefined) return
    const toggle = nativeToggle()
    if (!announced && toggle !== null) {
      announced = true
      window.parent.postMessage({ type: BOTTOM_MESSAGE, action: 'ready' }, window.location.origin)
    }
    if (announced && wasOpen && !snapshot.state.bottomOpen) {
      window.parent.postMessage({ type: BOTTOM_MESSAGE, action: 'collapsed' }, window.location.origin)
    }
    wasOpen = snapshot.state.bottomOpen
  }
  const ready = (): void => {
    update()
    if (!announced) raf = requestAnimationFrame(ready)
  }
  const receive = (event: MessageEvent<unknown>): void => {
    if (event.source !== window.parent || previewCommand(event, BOTTOM_MESSAGE)?.action !== 'show') return
    const snapshot = service.getSnapshot()
    if (snapshot.sessionId === sessionId && snapshot.state?.bottomOpen === false) nativeToggle()?.click()
  }
  const unsubscribe = service.subscribeState(update)
  window.addEventListener('message', receive)
  raf = requestAnimationFrame(ready)
  return () => {
    if (raf !== undefined) cancelAnimationFrame(raf)
    unsubscribe()
    window.removeEventListener('message', receive)
    restorePreview()
    style.remove()
    document.body.removeAttribute('data-dsh-docking-bottom-client')
    removeFrame()
    stopFollowing()
  }
}

/** Keep the optional service's structural typing local to this integration. */
export function installBottomClient(ctx: Context, sessionId: SessionId): void {
  ctx.inject(['betterSidebar' as never], scope => {
    scope.effect(() => installBottomFrame(scope, scope.get('betterSidebar' as never) as unknown as BottomService, sessionId),
      'docking-layout: persistent bottom frame')
  })
}
