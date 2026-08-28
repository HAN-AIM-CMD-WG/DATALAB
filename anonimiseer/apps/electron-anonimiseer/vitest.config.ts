import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Aliassen gelijk houden aan electron.vite.config.ts, anders lopen tests
// tegen andere module-resolutie aan dan de app zelf.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
