/** Same-origin frame mode used to host one independent stock DSH conversation. */
import type {
  ISessions, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Query parameter that addresses the Session rendered by an embedded DSH client. */
export const FRAME_SESSION_PARAM = 'dsh-docking-session'

/** Cross-frame signal emitted after an embedded client selects its addressed Session. */
export const FRAME_READY_MESSAGE = 'dsh-docking-layout:frame-ready'

/** Cross-frame signal emitted when an embedded directory selects another Session. */
export const FRAME_NAVIGATE_MESSAGE = 'dsh-docking-layout:frame-navigate'

/** Cross-frame signal emitted when a user focuses an embedded Session. */
export const FRAME_FOCUS_MESSAGE = 'dsh-docking-layout:frame-focus'

/** Cross-frame request for the outer client to toggle its directory sidebar. */
export const FRAME_TOGGLE_SIDEBAR_MESSAGE = 'dsh-docking-layout:frame-toggle-sidebar'

/** Message body accepted from same-origin embedded DSH clients. */
export interface FrameReadyMessage {
  readonly type: typeof FRAME_READY_MESSAGE
  readonly sessionId: SessionId
}

/** Request for the outer client to route one embedded directory selection. */
export interface FrameNavigateMessage {
  readonly type: typeof FRAME_NAVIGATE_MESSAGE
  readonly sessionId: SessionId
}

/** Signal used to keep the outer active group aligned with iframe focus. */
export interface FrameFocusMessage {
  readonly type: typeof FRAME_FOCUS_MESSAGE
  readonly sessionId: SessionId
}

/** Request emitted when an embedded mobile header control is activated. */
export interface FrameToggleSidebarMessage {
  readonly type: typeof FRAME_TOGGLE_SIDEBAR_MESSAGE
}

export type FrameMessage =
  | FrameReadyMessage
  | FrameNavigateMessage
  | FrameFocusMessage
  | FrameToggleSidebarMessage

type PostFrameMessage = (message: FrameMessage) => void

function postToParent(message: FrameMessage): void {
  if (window.parent !== window) window.parent.postMessage(message, window.location.origin)
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
export function followFrameSession(
  sessions: ISessions,
  sessionId: SessionId,
  postMessage: PostFrameMessage = postToParent,
): () => void {
  let requested = false
  let requestedPhase: SessionListState['phase'] | undefined
  let announced = false
  const sync = (): void => {
    const state: SessionListState = sessions.list.getSnapshot()
    if (state.byId[sessionId] === undefined) return
    if (state.current !== sessionId) {
      if (!requested || requestedPhase !== state.phase) {
        if (announced && state.current !== undefined && state.byId[state.current] !== undefined) {
          postMessage({ type: FRAME_NAVIGATE_MESSAGE, sessionId: state.current })
        }
        requested = true
        requestedPhase = state.phase
        sessions.open(sessionId)
      }
      return
    }
    requested = false
    requestedPhase = undefined
    if (!announced) {
      announced = true
      const message: FrameReadyMessage = { type: FRAME_READY_MESSAGE, sessionId }
      postMessage(message)
    }
  }
  const announceFocus = (): void => {
    postMessage({ type: FRAME_FOCUS_MESSAGE, sessionId })
  }
  window.addEventListener('focus', announceFocus)
  window.addEventListener('pointerdown', announceFocus, true)
  const unsubscribe = sessions.list.subscribe(sync)
  sync()
  return () => {
    unsubscribe()
    window.removeEventListener('focus', announceFocus)
    window.removeEventListener('pointerdown', announceFocus, true)
  }
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

/** Check a same-origin postMessage payload for an embedded directory selection. */
export function isFrameNavigateMessage(
  event: MessageEvent<unknown>,
): event is MessageEvent<FrameNavigateMessage> {
  if (event.origin !== window.location.origin || typeof event.data !== 'object' || event.data === null) {
    return false
  }
  const candidate = event.data as Partial<FrameNavigateMessage>
  return candidate.type === FRAME_NAVIGATE_MESSAGE
    && typeof candidate.sessionId === 'string'
    && candidate.sessionId !== ''
}

/** Check a same-origin postMessage payload for an embedded Session focus signal. */
export function isFrameFocusMessage(
  event: MessageEvent<unknown>,
): event is MessageEvent<FrameFocusMessage> {
  if (event.origin !== window.location.origin || typeof event.data !== 'object' || event.data === null) {
    return false
  }
  const candidate = event.data as Partial<FrameFocusMessage>
  return candidate.type === FRAME_FOCUS_MESSAGE
    && typeof candidate.sessionId === 'string'
    && candidate.sessionId !== ''
}

/** Check a same-origin postMessage payload for an outer-sidebar toggle request. */
export function isFrameToggleSidebarMessage(
  event: MessageEvent<unknown>,
): event is MessageEvent<FrameToggleSidebarMessage> {
  if (event.origin !== window.location.origin || typeof event.data !== 'object' || event.data === null) {
    return false
  }
  return (event.data as Partial<FrameToggleSidebarMessage>).type === FRAME_TOGGLE_SIDEBAR_MESSAGE
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
  grid-column: 2 !important;
  grid-row: 1 !important;
  margin-bottom: 0 !important;
}
`

/**
 * Remove duplicate shell chrome inside an embedded stock DSH client.
 * @returns cleanup for attributes, observer, and injected style.
 */
export function installFramePresentation(
  postMessage: PostFrameMessage = postToParent,
): () => void {
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

  const observer = new MutationObserver(markShell)
  markShell()
  observer.observe(document.documentElement, { childList: true, subtree: true })
  const handleMobileToggle = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element) || target.closest("button[data-mobile-nav='toggle']") === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    postMessage({ type: FRAME_TOGGLE_SIDEBAR_MESSAGE })
  }
  document.addEventListener('click', handleMobileToggle, true)

  return () => {
    observer.disconnect()
    document.removeEventListener('click', handleMobileToggle, true)
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
