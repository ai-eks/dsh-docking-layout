// @vitest-environment jsdom
/** Multi-workspace browsing must preserve independent roots and file provenance. */
import { createElement, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import {
  createWorkspaceFiles, WorkspaceFiles, workspaceTreeKey, type WorkspaceFilesProps,
} from '../src/client/workspace-files.tsx'

const A = { workspaceId: 'a', path: '/projects/a', title: 'Project A', sessionIds: ['session-a'] } as unknown as WorkspaceView
const B = { workspaceId: 'b', path: '/projects/b', title: 'Project B', sessionIds: ['session-b'] } as unknown as WorkspaceView
const result = (entries: WorkspaceDirectoryEntry[] = []) => ({ ok: true as const, value: { path: '', entries, truncated: false } })
const ROOT = [
  { name: 'README.md', type: 'file' },
  { name: 'src', type: 'directory' },
] satisfies WorkspaceDirectoryEntry[]

afterEach(cleanup)

describe('multi-workspace file tree', () => {
  it('loads roots lazily, opens same-name files with their own Session addresses, and retains state across remounts', async () => {
    const list = vi.fn(async (_id, path) => result(path.endsWith('/src') ? [{ name: 'main.ts', type: 'file' }] : ROOT))
    const connect = vi.fn()
    const files = createWorkspaceFiles(connect, list)
    const lifetime = new AbortController()
    const openResource = vi.fn()
    const props = {
      files, sessionId: 'session-a',
      useTabInfo: () => ({ tab: { id: 'files-1', signal: lifetime.signal, actions: { openResource } } }),
      useWorkspaces: (selector: (value: unknown) => unknown) => selector({ items: [A, B] }),
      useTrees: (selector: (value: ReturnType<typeof files.state.getSnapshot>) => unknown) =>
        useSyncExternalStore(files.state.subscribe, () => selector(files.state.getSnapshot())),
      t: (key: string) => key,
    } as unknown as WorkspaceFilesProps
    let view = render(createElement(WorkspaceFiles, props))
    expect(list).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Project A' }))
    fireEvent.click(view.getByRole('button', { name: 'Project B' }))
    await waitFor(() => { expect(view.getAllByRole('button', { name: 'README.md' })).toHaveLength(2) })
    const rootA = () => within(view.container.querySelector('[data-files-workspace="a"]') as HTMLElement)
    const rootB = () => within(view.container.querySelector('[data-files-workspace="b"]') as HTMLElement)
    fireEvent.click(rootA().getByRole('button', { name: 'README.md' }))
    fireEvent.click(rootB().getByRole('button', { name: 'README.md' }))
    expect(openResource.mock.calls).toEqual([
      ['dsh-resource://file/session/session-a/README.md'],
      ['dsh-resource://file/session/session-b/README.md'],
    ])
    fireEvent.click(rootA().getByRole('button', { name: 'src' }))
    await waitFor(() => { expect(rootA().getByRole('button', { name: 'main.ts' })).toBeTruthy() })
    expect(rootB().getByRole('button', { name: 'src' }).getAttribute('aria-expanded')).toBe('false')
    const scroll = view.getByRole('list', { name: 'files.workspaces' })
    fireEvent.scroll(scroll, { target: { scrollTop: 123 } })
    view.unmount()
    view = render(createElement(WorkspaceFiles, { ...props, sessionId: 'session-b' as never }))
    expect(view.getByRole('button', { name: 'main.ts' })).toBeTruthy()
    expect(view.getByRole('list', { name: 'files.workspaces' }).scrollTop).toBe(123)
    expect(list).toHaveBeenCalledTimes(3)
    expect(connect).not.toHaveBeenCalled()
    act(() => { lifetime.abort() })
    expect(files.state.getSnapshot()).toEqual({})
    expect(files.scroll.size).toBe(0)
  })

  it('ignores pre-reload listings without changing another root or expanded directories', async () => {
    const pending: Array<(value: ReturnType<typeof result>) => void> = []
    const list = vi.fn((_id, _path, _signal) => new Promise<ReturnType<typeof result>>(resolve => pending.push(resolve)))
    const files = createWorkspaceFiles(vi.fn(), list)
    const lifetime = new AbortController()
    const a = workspaceTreeKey('tab', A.workspaceId)
    const b = workspaceTreeKey('tab', B.workspaceId)
    files.toggleWorkspace('tab', A, lifetime.signal)
    files.toggleWorkspace('tab', B, lifetime.signal)
    pending[1]!(result(ROOT))
    await Promise.resolve()
    files.toggle(a, '/projects/a/src')
    files.reload('tab', [A], lifetime.signal)
    expect(list.mock.calls[0]![2].aborted).toBe(true)
    pending[0]!(result([{ name: 'stale.md', type: 'file' }]))
    pending[2]!(result([{ name: 'stale.ts', type: 'file' }]))
    pending[3]!(result(ROOT))
    pending[4]!(result([{ name: 'fresh.ts', type: 'file' }]))
    await Promise.resolve()
    expect(files.state.getSnapshot()[a]!.expanded).toEqual(['/projects/a', '/projects/a/src'])
    expect(files.state.getSnapshot()[a]!.levels['/projects/a/src']).toEqual({ loading: false, result: result([{ name: 'fresh.ts', type: 'file' }]) })
    expect(files.state.getSnapshot()[b]!.levels['/projects/b']).toEqual({ loading: false, result: result(ROOT) })
    lifetime.abort()
    expect(files.state.getSnapshot()).toEqual({})
  })

  it('connects an empty workspace only on expansion and preserves collapse during connection', async () => {
    let resolve!: (id: typeof A.sessionIds[number]) => void
    const connect = vi.fn(() => new Promise<typeof A.sessionIds[number]>(done => { resolve = done }))
    const list = vi.fn(async () => result())
    const files = createWorkspaceFiles(connect, list)
    const workspace = { ...A, sessionIds: [] }
    const lifetime = new AbortController()
    files.toggleWorkspace('tab', workspace, lifetime.signal)
    expect(connect).toHaveBeenCalledExactlyOnceWith(A.workspaceId)
    files.toggleWorkspace('tab', workspace, lifetime.signal)
    resolve(A.sessionIds[0]!)
    await Promise.resolve()
    expect(files.state.getSnapshot()[workspaceTreeKey('tab', A.workspaceId)]!.expanded).toEqual([])
    expect(list).toHaveBeenCalledOnce()
    lifetime.abort()
  })

  it('discards a delayed workspace connection when its tab closes', async () => {
    let resolve!: (id: typeof A.sessionIds[number]) => void
    const files = createWorkspaceFiles(() => new Promise(done => { resolve = done }), vi.fn())
    const lifetime = new AbortController()
    files.toggleWorkspace('tab', { ...A, sessionIds: [] }, lifetime.signal)
    lifetime.abort()
    resolve(A.sessionIds[0]!)
    await Promise.resolve()
    expect(files.state.getSnapshot()).toEqual({})
  })

  it('shows listing failures and recovers through reload', async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: false, error: { message: 'Directory unavailable' } }).mockResolvedValue(result())
    const files = createWorkspaceFiles(vi.fn(), list)
    const lifetime = new AbortController()
    const key = workspaceTreeKey('tab', A.workspaceId)
    files.toggleWorkspace('tab', A, lifetime.signal)
    await Promise.resolve()
    expect(files.state.getSnapshot()[key]!.levels[A.path]).toEqual({ loading: false, result: { ok: false, error: { message: 'Directory unavailable' } } })
    files.reload('tab', [A], lifetime.signal)
    await Promise.resolve()
    expect(files.state.getSnapshot()[key]!.levels[A.path]).toEqual({ loading: false, result: result() })
    files.dispose()
  })

  it('records a rejected child listing without losing other roots and recovers through reload', async () => {
    const list = vi.fn().mockResolvedValue(result(ROOT))
    const files = createWorkspaceFiles(vi.fn(), list)
    const lifetime = new AbortController()
    const a = workspaceTreeKey('tab', A.workspaceId)
    const b = workspaceTreeKey('tab', B.workspaceId)
    files.toggleWorkspace('tab', A, lifetime.signal)
    files.toggleWorkspace('tab', B, lifetime.signal)
    await Promise.resolve()
    const otherRoot = files.state.getSnapshot()[b]
    list.mockRejectedValueOnce(new Error('Connection lost'))
    files.toggle(a, `${A.path}/src`)
    await waitFor(() => {
      expect(files.state.getSnapshot()[a]!.levels[`${A.path}/src`]).toEqual({
        loading: false, result: { ok: false, error: { message: 'Connection lost' } },
      })
    })
    expect(files.state.getSnapshot()[a]!.levels[A.path]).toEqual({ loading: false, result: result(ROOT) })
    expect(files.state.getSnapshot()[b]).toBe(otherRoot)
    list.mockResolvedValue(result())
    files.reload('tab', [A], lifetime.signal)
    await Promise.resolve()
    expect(files.state.getSnapshot()[a]!.levels[`${A.path}/src`]).toEqual({ loading: false, result: result() })
    lifetime.abort()
  })

  it.each(['reload', 'close'] as const)('handles a rejected child request when %s aborts it', async (action) => {
    const list = vi.fn().mockResolvedValue(result(ROOT))
    const files = createWorkspaceFiles(vi.fn(), list)
    const lifetime = new AbortController()
    const key = workspaceTreeKey('tab', A.workspaceId)
    files.toggleWorkspace('tab', A, lifetime.signal)
    await Promise.resolve()
    list.mockImplementationOnce((_id, _path, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new DOMException('Cancelled', 'AbortError')) }, { once: true })
    }))
    files.toggle(key, `${A.path}/src`)
    if (action === 'reload') files.reload('tab', [A], lifetime.signal)
    else lifetime.abort()
    // Allow rejected fire-and-forget requests to surface as unhandled errors.
    await new Promise(resolve => setTimeout(resolve, 0))
    if (action === 'reload') {
      expect(files.state.getSnapshot()[key]!.levels[`${A.path}/src`]).toEqual({ loading: false, result: result(ROOT) })
      expect(files.state.getSnapshot()[key]!.error).toBeUndefined()
    } else expect(files.state.getSnapshot()).toEqual({})
    lifetime.abort()
  })
})
