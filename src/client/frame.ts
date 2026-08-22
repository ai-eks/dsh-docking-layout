/** Same-origin frame mode used to host one independent stock DSH conversation. */
import type {
  ISessions, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Query parameter that addresses the Session rendered by an embedded DSH client. */
export const FRAME_SESSION_PARAM = 'dsh-docking-session'

/** Cross-frame signal emitted after an embedded client selects its addressed Session. */
export const FRAME_READY_MESSAGE = 'dsh-docking-layout:frame-ready'

/** Message body accepted from same-origin embedded DSH clients. */
export interface FrameReadyMessage {
  readonly type: typeof FRAME_READY_MESSAGE
  readonly sessionId: SessionId
}

/**
 * Read the embedded Session address from a URL.
 * @param href - absolute browser URL.
 * @param embedded - whether the current document is inside another window.
 * @returns the addressed Session, or undefined in the outer DSH client.
 */
export function frameSessionId(
  href = window.location.href,
  embedded = window.parent !== window,
): SessionId | undefined {
  if (!embedded) return undefined
  const value = new URL(href).searchParams.get(FRAME_SESSION_PARAM)
  return value === null || value === '' ? undefined : value as SessionId
}

/**
 * Address a same-origin DSH client at one Session.
 * @param sessionId - Session rendered inside the frame.
 * @param href - outer DSH URL.
 * @returns an absolute frame URL preserving unrelated query and hash state.
 */
export function sessionFrameUrl(
  sessionId: SessionId,
  href = window.location.href,
): string {
  const url = new URL(href)
  url.searchParams.set(FRAME_SESSION_PARAM, sessionId)
  return url.toString()
}

/**
 * Keep an embedded DSH client on its addressed Session.
 * @param sessions - stock DSH Session service.
 * @param sessionId - fixed frame address.
 * @returns the list subscription disposer.
 */
export function followFrameSession(sessions: ISessions, sessionId: SessionId): () => void {
  let requested = false
  let announced = false
  const sync = (): void => {
    const state: SessionListState = sessions.list.getSnapshot()
    if (state.byId[sessionId] === undefined) return
    if (state.current !== sessionId) {
      if (!requested) {
        requested = true
        sessions.open(sessionId)
      }
      return
    }
    requested = false
    if (!announced && window.parent !== window) {
      announced = true
      const message: FrameReadyMessage = { type: FRAME_READY_MESSAGE, sessionId }
      window.parent.postMessage(message, window.location.origin)
    }
  }
  sync()
  return sessions.list.subscribe(sync)
}

/**
 * Check a same-origin postMessage payload from an embedded DSH client.
 * @param event - browser message event.
 * @returns whether the event is a Docking Layout readiness signal.
 */
export function isFrameReadyMessage(event: MessageEvent<unknown>): event is MessageEvent<FrameReadyMessage> {
  if (event.origin !== window.location.origin || typeof event.data !== 'object' || event.data === null) {
    return false
  }
  const candidate = event.data as Partial<FrameReadyMessage>
  return candidate.type === FRAME_READY_MESSAGE
    && typeof candidate.sessionId === 'string'
    && candidate.sessionId !== ''
}

const FRAME_STYLE = `
body[data-dsh-docking-frame] #root {
  margin-right: 0 !important;
  width: 100% !important;
}
body[data-dsh-docking-frame] [data-dsh-docking-frame-shell] {
  grid-template-columns: 0 minmax(0, 1fr) 0 !important;
}
body[data-dsh-docking-frame] [data-dsh-docking-frame-sidebar],
body[data-dsh-docking-frame] [data-dsh-docking-frame-details],
body[data-dsh-docking-frame] [data-shell-overlay],
body[data-dsh-docking-frame] [data-dsh-panel-host],
body[data-dsh-docking-frame] [data-side='sidebar'],
body[data-dsh-docking-frame] [data-side='details'] {
  display: none !important;
}
body[data-dsh-docking-frame] [data-dsh-docking-frame-conversation] {
  margin-bottom: 0 !important;
}
`

/**
 * Remove duplicate shell chrome inside an embedded stock DSH client.
 * @returns cleanup for attributes, observer, and injected style.
 */
export function installFramePresentation(): () => void {
  document.body.setAttribute('data-dsh-docking-frame', '')
  const style = document.createElement('style')
  style.dataset.dshDockingFrameStyle = ''
  style.textContent = FRAME_STYLE
  document.head.append(style)

  const marked = new Set<Element>()
  const mark = (element: Element | null, attribute: string): boolean => {
    if (element === null) return false
    element.setAttribute(attribute, '')
    marked.add(element)
    return true
  }
  const markShell = (): boolean => {
    const root = document.querySelector('[data-slot="root"]')
    const sidebar = document.querySelector('[data-slot="sidebar"]')
    const conversation = document.querySelector('[data-slot="conversation"]')
    const details = document.querySelector('[data-slot="details"]')
    return [
      mark(root?.firstElementChild ?? null, 'data-dsh-docking-frame-shell'),
      mark(sidebar?.parentElement ?? null, 'data-dsh-docking-frame-sidebar'),
      mark(conversation?.parentElement ?? null, 'data-dsh-docking-frame-conversation'),
      mark(details?.parentElement ?? null, 'data-dsh-docking-frame-details'),
    ].every(Boolean)
  }

  const observer = new MutationObserver(() => {
    if (markShell()) observer.disconnect()
  })
  if (!markShell()) observer.observe(document.documentElement, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    document.body.removeAttribute('data-dsh-docking-frame')
    style.remove()
    for (const element of marked) {
      element.removeAttribute('data-dsh-docking-frame-shell')
      element.removeAttribute('data-dsh-docking-frame-sidebar')
      element.removeAttribute('data-dsh-docking-frame-conversation')
      element.removeAttribute('data-dsh-docking-frame-details')
    }
  }
}
