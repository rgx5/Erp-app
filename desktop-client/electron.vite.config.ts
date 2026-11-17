import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: { build: { outDir: 'out/main', lib: { entry: resolve('electron/main/index.ts') } } },
  preload: { build: { outDir: 'out/preload', lib: { entry: resolve('electron/preload/index.ts') } } },
  renderer: {
    root: '.',
    build: { outDir: 'out/renderer', rollupOptions: { input: resolve('index.html') } },
    resolve: { alias: { '@': resolve('src') } },
    plugins: [react(), tailwindcss()],
  },
})
