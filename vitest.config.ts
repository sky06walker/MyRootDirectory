import { defineConfig } from 'vitest/config'

// Unit/function tests run in plain Node: the code under test only uses Web-standard
// APIs (Request, Response, fetch, crypto.subtle, TextEncoder) that Node provides.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
