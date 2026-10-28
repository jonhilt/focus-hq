import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: 'client',
  // Tailwind's utilities, for the screens drawn with them (plugins/chief-of-staff/bridge.css)
  plugins: [tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      // the 3D ship, and the Tricorder: the phone view, which must stay free of three.js
      input: { main: page('client/index.html'), tricorder: page('client/tricorder/index.html') },
    },
  },
});
