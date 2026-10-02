import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

// Compile the engineering harness separately from the unfinished product lobby.
export default defineConfig({build: {
  outDir: 'dist-check',
  rollupOptions: {input: fileURLToPath(new URL('./browser-harness.html', import.meta.url))},
}});
