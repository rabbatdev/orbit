import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Resolve the Orbit packages straight from their TypeScript source — no library
// build step. Vite transpiles them on the fly (client + SSR). The app's API
// routes live in src/routes/api/ (push.ts, query.ts).
export default defineConfig({
  plugins: [
    tanstackStart(), // must come before react()
    viteReact(),
  ],
  resolve: {
    alias: [
      // Most-specific first so '@orbit/server' doesn't shadow '@orbit/server/pg'.
      { find: '@orbit/server/pg', replacement: fileURLToPath(new URL('../../packages/server/src/pg.ts', import.meta.url)) },
      { find: '@orbit/server', replacement: fileURLToPath(new URL('../../packages/server/src/index.ts', import.meta.url)) },
      { find: '@orbit/client', replacement: fileURLToPath(new URL('../../packages/client/src/index.ts', import.meta.url)) },
      { find: '@orbit/react', replacement: fileURLToPath(new URL('../../packages/react/src/index.ts', import.meta.url)) },
    ],
  },
});
