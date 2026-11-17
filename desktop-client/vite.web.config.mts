// The renderer on its own, served to a normal browser. Used for development without Electron and for the end-to-end tests.
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  resolve: { alias: { '@': resolve('src') } },
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'out/web' },
})
