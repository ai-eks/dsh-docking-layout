type Listener = () => void

export function defineStore(declaration: {
  init: () => unknown
  actions: Record<string, (draft: never, ...params: unknown[]) => void>
}) {
  return {
    spec: declaration,
    create() {
      let snapshot = declaration.init()
      const listeners = new Set<Listener>()
      const store = {
        getSnapshot: () => snapshot,
        subscribe(listener: Listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        update(update: (draft: never) => void) {
          const draft = structuredClone(snapshot)
          update(draft as never)
          snapshot = draft
          for (const listener of listeners) listener()
        },
      }
      const actions = Object.fromEntries(Object.entries(declaration.actions).map(([name, action]) => [
        name,
        (...params: unknown[]) => { store.update(draft => { action(draft, ...params) }) },
      ]))
      return {
        actions,
        store,
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        clearPersisted() {},
      }
    },
  }
}
