import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

// Compile the engineering harness separately from the player-facing peer lobby.
export default defineConfig({build: {
  outDir: 'dist-check',
  rollupOptions: {input: {server:fileURLToPath(new URL('./browser-harness.html', import.meta.url)), peer:fileURLToPath(new URL('./peer-harness.html', import.meta.url))}},
}});
