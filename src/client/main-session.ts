import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The main view's Session is now identified by its retained reference. */
export function mainSessionId(state: SessionListState): SessionId | undefined {
  return Object.values(state.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
}
