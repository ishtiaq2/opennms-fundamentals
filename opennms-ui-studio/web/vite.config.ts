import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// npm run dev: this page at http://<this machine>:5173, the API of the studio's server (port 8990) behind /api.
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.STUDIO_PORT ?? 8990}`, changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
})
