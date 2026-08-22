/** Persisted browser-only state for Docking Layout. */
import {
  defineStore, type EngineStoreHandle,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionLayoutNode } from './layout.ts'

/** Session-workbench viewing preferences; Session data remains Host-owned. */
export interface DockingLayoutState {
  enabled: boolean
  layout: SessionLayoutNode | undefined
  activeGroupId: string | undefined
  nextGroup: number
}

type DockingLayoutActions = {
  setEnabled: (draft: DockingLayoutState, enabled: boolean) => void
  setLayout: (
    draft: DockingLayoutState,
    layout: SessionLayoutNode | undefined,
    activeGroupId: string | undefined,
    nextGroup: number,
  ) => void
}

/**
 * Create the root-scoped Docking Layout preference store.
 * @returns a store handle persisted independently from all Session logs.
 */
export function createDockingLayoutStore(): EngineStoreHandle<DockingLayoutState, DockingLayoutActions> {
  return defineStore({
    init: (): DockingLayoutState => ({
      enabled: true,
      layout: undefined,
      activeGroupId: undefined,
      nextGroup: 1,
    }),
    persist: 'dsh.docking-layout.v1',
    actions: {
      setEnabled: (draft, enabled: boolean) => { draft.enabled = enabled },
      setLayout: (draft, layout, activeGroupId, nextGroup) => {
        draft.layout = layout
        draft.activeGroupId = activeGroupId
        draft.nextGroup = nextGroup
      },
    },
  })
}
