import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-runtime/client': new URL(
        './tests/stubs/runtime-client.ts', import.meta.url,
      ).pathname,
      '@deepseek-ai/dsh-client-ui-primitives': new URL(
        './tests/stubs/ui-primitives.tsx', import.meta.url,
      ).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
