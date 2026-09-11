/** Independent workspace roots share one file-browser tab. */
import { useCallback, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceDirectoryListing } from '@deepseek-ai/dsh-api-workspace-files/types'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { FileTypeIcon, classifyFileType, IconChevronDownOutline14, IconChevronRightOutline14, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkspaceFiles.module.css'

type Listing = { ok: true; value: WorkspaceDirectoryListing } | { ok: false; error: { message: string } }
type Level = { loading: true } | { loading: false; result: Listing }
export interface WorkspaceTree {
  workspace: WorkspaceView
  sessionId?: SessionId
  error?: string
  levels: Record<string, Level>
  expanded: string[]
}

/** A workspace's directory state is independent in each native Files tab. */
export const workspaceTreeKey = (tabId: string, workspaceId: WorkspaceId): string => JSON.stringify([tabId, workspaceId])

/** Directory requests are lazy and end with their tab or a manual reload. */
export function createWorkspaceFiles(
  connect: (id: WorkspaceId) => Promise<SessionId>,
  list: (id: SessionId, path: string, signal: AbortSignal) => Promise<Listing>,
) {
  const state = createSnapshotStore<Record<string, WorkspaceTree>>({})
  const lifetimes = new Map<string, () => void>()
  const signals = new Map<string, AbortSignal>()
  const scroll = new Map<string, number>()
  const put = (id: string, tree: WorkspaceTree): void => { state.set({ ...state.getSnapshot(), [id]: tree }) }
  const load = async (id: string, path: string): Promise<void> => {
    const tree = state.getSnapshot()[id]
    const signal = signals.get(id)
    if (tree?.sessionId === undefined || signal === undefined || signal.aborted) return
    put(id, { ...tree, levels: { ...tree.levels, [path]: { loading: true } } })
    let result: Listing
    try {
      result = await list(tree.sessionId, path, signal)
    } catch (error) {
      if (signal.aborted) return
      result = { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
    }
    if (signal.aborted) return
    const current = state.getSnapshot()[id]!
    put(id, { ...current, levels: { ...current.levels, [path]: { loading: false, result } } })
  }
  const start = async (tabId: string, workspace: WorkspaceView, parent: AbortSignal): Promise<void> => {
    const id = workspaceTreeKey(tabId, workspace.workspaceId)
    lifetimes.get(id)?.()
    if (parent.aborted) return
    const controller = new AbortController()
    signals.set(id, controller.signal)
    const forget = (): void => {
      lifetimes.get(id)?.()
      lifetimes.delete(id)
      signals.delete(id)
      scroll.delete(tabId)
      const { [id]: removed, ...remaining } = state.getSnapshot()
      state.set(remaining)
    }
    parent.addEventListener('abort', forget, { once: true })
    lifetimes.set(id, () => {
      controller.abort()
      parent.removeEventListener('abort', forget)
    })
    put(id, { workspace, levels: {}, expanded: state.getSnapshot()[id]?.expanded ?? [workspace.path] })
    try {
      // An existing Session supplies file access; connecting an empty Workspace
      // creates its blank Session without selecting it in the conversation UI.
      const sessionId = workspace.sessionIds[0] ?? await connect(workspace.workspaceId)
      if (controller.signal.aborted) return
      const tree = state.getSnapshot()[id]!
      put(id, { ...tree, sessionId })
      await Promise.all([...new Set([workspace.path, ...tree.expanded])].map(path => load(id, path)))
    } catch (error) {
      if (!controller.signal.aborted) put(id, { ...state.getSnapshot()[id]!, error: String(error) })
    }
  }
  const toggle = (id: string, path: string): void => {
    const tree = state.getSnapshot()[id]!
    const expanded = tree.expanded.includes(path)
    put(id, { ...tree, expanded: expanded ? tree.expanded.filter(value => value !== path) : [...tree.expanded, path] })
    if (!expanded && tree.levels[path] === undefined) void load(id, path)
  }
  return {
    state, toggle, scroll,
    toggleWorkspace(tabId: string, workspace: WorkspaceView, signal: AbortSignal) {
      const id = workspaceTreeKey(tabId, workspace.workspaceId)
      if (state.getSnapshot()[id] === undefined) void start(tabId, workspace, signal)
      else toggle(id, workspace.path)
    },
    reload(tabId: string, workspaces: readonly WorkspaceView[], signal: AbortSignal) {
      for (const workspace of workspaces) {
        const id = workspaceTreeKey(tabId, workspace.workspaceId)
        if (state.getSnapshot()[id] !== undefined) void start(tabId, workspace, signal)
      }
    },
    dispose() { for (const stop of lifetimes.values()) stop(); lifetimes.clear(); signals.clear(); scroll.clear() },
  }
}

type Files = ReturnType<typeof createWorkspaceFiles>
type Injected = { files: Files; hooks: { trees: Files['state'] } }
export type WorkspaceFilesProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'docking-layout'> & InjectFace<Injected>
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Expanding a workspace never selects its Session or changes existing previews. */
export function WorkspaceFiles({ useTabInfo, useWorkspaces, files, useTrees, t }: WorkspaceFilesProps): ReactNode {
  const { tab } = useTabInfo()
  const workspaces = useWorkspaces(value => value.items)
  const trees = useTrees(value => value)
  const restoreScroll = useCallback((element: HTMLUListElement | null) => {
    if (element !== null) element.scrollTop = files.scroll.get(tab.id) ?? 0
  }, [files, tab.id])
  const open = (tree: WorkspaceTree, path: string): void => {
    if (tree.sessionId !== undefined) tab.actions.openResource(fileAddressFor(tree.sessionId, tree.workspace.path, path))
  }
  const level = (id: string, tree: WorkspaceTree, path: string): ReactNode => {
    const value = tree.levels[path]
    if (value === undefined || value.loading) return <li className={css.note}>{t('files.loading')}</li>
    if (!value.result.ok) return <li className={css.note} role="alert">{value.result.error.message}</li>
    const entries = [...value.result.value.entries].sort((a, b) =>
      Number(b.type === 'directory') - Number(a.type === 'directory') || byName.compare(a.name, b.name))
    return <>
      {entries.length === 0 && <li className={css.note}>{t('files.empty')}</li>}
      {entries.map(entry => {
        const child = `${path.replace(/[/\\]+$/, '')}/${entry.name}`
        const directory = entry.type === 'directory'
        const expanded = tree.expanded.includes(child)
        return <li key={entry.name}>
          <button className={css.row} type="button" disabled={entry.type === 'other'}
            aria-expanded={directory ? expanded : undefined}
            onClick={() => { if (directory) files.toggle(id, child); else open(tree, child) }}>
            {directory ? expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 /> : <span className={css.spacer} />}
            <FileTypeIcon kind={directory ? 'folder' : classifyFileType(entry.name)} size={16} />
            <span>{entry.name}</span>
          </button>
          {directory && expanded && <ul className={css.nested}>{level(id, tree, child)}</ul>}
        </li>
      })}
      {value.result.value.truncated && <li className={css.note}>{t('files.truncated')}</li>}
    </>
  }
  return <div className={css.root} data-docking-workspace-files="">
    <div className={css.header}>
      <span>{t('files.workspaces')}</span>
      <button className={css.reload} type="button" aria-label={t('files.reload')}
        onClick={() => { files.reload(tab.id, workspaces, tab.signal) }}><IconRefreshOutline16 /></button>
    </div>
    <ul className={css.tree} aria-label={t('files.workspaces')} ref={restoreScroll}
      onScroll={event => { files.scroll.set(tab.id, event.currentTarget.scrollTop) }}>
      {workspaces.length === 0 && <li className={css.note}>{t('files.noWorkspaces')}</li>}
      {workspaces.map(workspace => {
        const id = workspaceTreeKey(tab.id, workspace.workspaceId)
        const tree = trees[id]
        const expanded = tree?.expanded.includes(workspace.path) ?? false
        return <li key={workspace.workspaceId} data-files-workspace={workspace.workspaceId}>
          <button type="button" className={`${css.row} ${css.workspace}`} title={workspace.path}
            aria-expanded={expanded} onClick={() => { files.toggleWorkspace(tab.id, workspace, tab.signal) }}>
            {expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
            <FileTypeIcon kind="folder" size={16} />
            <span>{workspace.title}</span>
          </button>
          {expanded && tree !== undefined && <ul className={css.nested}>
            {tree.error !== undefined ? <li className={css.note} role="alert">{tree.error}</li> : level(id, tree, workspace.path)}
          </ul>}
        </li>
      })}
    </ul>
  </div>
}

/** Override only the files body inside the persistent preview iframe. */
export function installWorkspaceFiles(ctx: Context): void {
  const files = createWorkspaceFiles(id => ctx.uiWorkspace.connectWorkspace(id),
    (id, path, signal) => ctx.remote.workspaceFiles.list(id, path, signal))
  ctx.effect(() => () => { files.dispose() }, 'docking-layout: workspace file requests')
  for (const key of ['@deepseek-ai/dsh-client-ui-sidebar-files', 'dsh-better-sidebar:files']) {
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key, priority: -10,
      locale: 'docking-layout', inject: (): Injected => ({ files, hooks: { trees: files.state } }),
    }, WorkspaceFiles))
  }
}
