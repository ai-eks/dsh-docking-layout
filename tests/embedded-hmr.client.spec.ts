// @vitest-environment jsdom
/** Embedded clients free SSE connections only after the host's boot audit. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { suspendEmbeddedHmr } from '../src/client/embedded-hmr.ts'

afterEach(() => { document.body.replaceChildren() })

it('waits for application mount, closes the actual plugin effect, and restores on unload', async () => {
  const root = new Context()
  const opened = vi.fn()
  const closed = vi.fn()
  const plugin = (ctx: Context): void => { ctx.effect(() => { opened(); return closed }) }
  const entry = {
    options: { name: '@deepseek-ai/dsh-client-hmr' }, ctx: root,
    fiber: await root.plugin(plugin),
    refresh: vi.fn(async () => { entry.fiber = await root.plugin(plugin) }),
  }
  let dispose = () => {}
  const scope = {
    get: () => ({ entries: () => [entry] }),
    effect: (run: () => () => void) => { dispose = run() },
  }
  suspendEmbeddedHmr({ inject: (_: unknown, run: (ctx: unknown) => void) => run(scope) } as unknown as Context)
  await Promise.resolve()
  expect(closed).not.toHaveBeenCalled()
  const main = document.createElement('main')
  main.dataset.slot = 'main'
  document.body.append(main)
  await vi.waitFor(() => { expect(entry.fiber).toBeUndefined() })
  expect(closed).toHaveBeenCalledOnce()
  expect(root.registry.has(plugin)).toBe(false)
  dispose()
  await vi.waitFor(() => { expect(opened).toHaveBeenCalledTimes(2) })
  expect(entry.refresh).toHaveBeenCalledOnce()
  await root.fiber.dispose()
})

it('does not loop on a retained settled transition and cancels discovery on unload', async () => {
  const entry = {
    options: { name: '@deepseek-ai/dsh-client-hmr' },
    ctx: { registry: { delete: vi.fn() } },
    fiber: { runtime: { callback: () => {} }, inertia: Promise.resolve() },
    refresh: vi.fn(async () => {}),
  }
  let dispose = () => {}
  const scope = { get: () => ({ entries: () => [entry] }), effect: (run: () => () => void) => { dispose = run() } }
  const ctx = { inject: (_: unknown, run: (ctx: unknown) => void) => run(scope) } as unknown as Context
  suspendEmbeddedHmr(ctx)
  dispose()
  document.body.innerHTML = '<main data-slot="main"></main>'
  await Promise.resolve()
  expect(entry.ctx.registry.delete).not.toHaveBeenCalled()
  suspendEmbeddedHmr(ctx)
  await vi.waitFor(() => { expect(entry.fiber).toBeUndefined() })
  dispose()
  expect(entry.refresh).toHaveBeenCalledOnce()
})
