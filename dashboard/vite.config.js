import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';

// Personal settings (names, location, URL) live in the gitignored local.config.json.
// See local.config.example.json.
const local = existsSync('local.config.json') ? JSON.parse(readFileSync('local.config.json', 'utf8')) : {};

// The wall tablet runs Android WebView 106 — keep JS output within Chromium 106.
// CSS targets chrome61 on purpose: the tablet's WebView rejects 4/8-digit hex colours (#0000,
// #ffffffbf) even though Chrome 106 should support them, and a newer target lets the minifier
// rewrite transparent/rgba() into that form. Verified on-device with CSS.supports().
export default defineConfig({
  define: { __LOCAL_PEOPLE__: JSON.stringify(local.people || {}) },
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
    // One script, so the iPhone page can sign its own files in. The views are imported
    // before the app starts anyway, so they were never a later download.
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  server: { host: true },
});
