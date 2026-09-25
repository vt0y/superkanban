import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envPrefix: ['VITE_', 'ALLOWED_', 'CONNECTS_'],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Pin the domain so tests don't depend on the local .env.
    env: { ALLOWED_EMAIL_DOMAINS: 'example.com' },
  },
});

