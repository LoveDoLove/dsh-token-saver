import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'node:path'

export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.js', '.jsx', '.tsx', '.json'],
    alias: {
      '~': path.resolve(__dirname, '.'),
    },
  },
  plugins: [tsconfigPaths()],
  server: {
    fs: { allow: [path.resolve(__dirname)] },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
    },
  },
})
