import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  cacheDir: resolve(__dirname, '.vite-cache'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
