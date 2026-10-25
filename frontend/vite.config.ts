import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Keep the exported app runnable without the Figma Make preview runtime.
export default defineConfig({
  server: { proxy: Object.fromEntries(['/api','/studio','/media','/export','/google','/docs','/openapi.json','/workflows','/testing','/connections','/writing','/ideas','/outputs','/legacy','/console','/tools','/production','/music','/images'].map(path => [path, {
    target: process.env.PARAMYTH_BACKEND || 'http://127.0.0.1:8770', changeOrigin: true,
    configure(proxy: any) { proxy.on('proxyReq', (out: any, req: any) => { if (req.headers.origin === `http://${req.headers.host}`) out.setHeader('Origin', process.env.PARAMYTH_BACKEND || 'http://127.0.0.1:8770') }) },
  }])) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
