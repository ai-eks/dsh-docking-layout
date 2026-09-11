/** Embedded clients must not exhaust HTTP/1's connection pool with dev-only SSE streams. */
import type { Context, Fiber } from '@deepseek-ai/cordis'

interface HmrEntry {
  options: { name?: string }
  ctx: Context
  fiber?: Fiber
  refresh(): Promise<unknown>
}
interface ClientLoader { entries(): Iterable<HmrEntry> }

/** Keep HMR in the outer client; nested clients refresh with their owning page. */
export function suspendEmbeddedHmr(ctx: Context): void {
  ctx.inject(['loader' as never], scope => {
    scope.effect(() => {
      const loader = scope.get('loader' as never) as unknown as ClientLoader
      let disposed = false
      let suspending = false
      let suspended: HmrEntry | undefined
      const resume = (entry: HmrEntry): void => {
        void entry.refresh().catch(error => console.warn('embedded HMR restore failed:', error))
      }
      const suspend = async (): Promise<void> => {
        if (disposed || suspending || suspended !== undefined) return
        const entry = Array.from(loader.entries()).find(item => item.options.name === '@deepseek-ai/dsh-client-hmr')
        const fiber = entry?.fiber
        const runtime = fiber?.runtime
        if (entry === undefined || fiber === undefined || runtime === null || runtime === undefined) return
        suspending = true
        // Same registry-first teardown as DSH's HMR driver: disposing a fiber
        // directly would incorrectly mark its loader entry disabled.
        entry.ctx.registry.delete(runtime.callback)
        // Await this teardown once; never spin on a retained settled promise
        // and starve the browser event loop.
        await fiber.inertia
        if (entry.fiber === fiber) delete entry.fiber
        suspended = entry
        if (disposed) resume(entry)
      }
      // The host audits every entry before mounting the application. Unloading
      // HMR during that audit makes an otherwise healthy embedded client fail boot.
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-slot="main"]') === null) return
        observer.disconnect()
        void suspend().catch(error => console.warn('embedded HMR suspension failed:', error))
      })
      observer.observe(document.body, { childList: true, subtree: true })
      if (document.querySelector('[data-slot="main"]') !== null) {
        observer.disconnect()
        void suspend().catch(error => console.warn('embedded HMR suspension failed:', error))
      }
      return () => {
        disposed = true
        observer.disconnect()
        if (suspended !== undefined) resume(suspended)
      }
    }, 'docking-layout: outer-only hot reload')
  })
}
