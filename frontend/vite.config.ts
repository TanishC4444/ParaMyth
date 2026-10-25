import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Keep the exported app runnable without the Figma Make preview runtime.
export default defineConfig({
  server: { proxy: Object.fromEntries(['/api','/studio','/media','/export','/google','/docs','/openapi.json','/workflows','/testing','/connections','/writing','/ideas','/outputs','/legacy','/console','/tools','/production','/music','/images'].map(path => [path, {
    target: process.env.PARAMYTH_BACKEND || 'http://127.0.0.1:8770', changeOrigin: true,
    configure(proxy: any) { proxy.on('proxyReq', (out: any, req: any) => { if (req.headers.origin === `http://${req.headers.host}`) out.setHeader('Origin', process.env.PARAMYTH_BACKEND || 'http://127.0.0.1:8770') }) },
  }])) },
  plugins: [react(), tailwindcss(), {
    name: 'publish-account-pages',
    async closeBundle() {
      const base = process.env.VITE_API_BASE || ''
      if (base && (new URL(base).protocol !== 'https:' || new URL(base).origin !== base.replace(/\/$/, ''))) throw Error('VITE_API_BASE must be one HTTPS origin')
      const web = fileURLToPath(new URL('../web/', import.meta.url))
      const output = resolve('dist/studio')
      await mkdir(resolve(output, 'js'), { recursive: true })
      const html = await readFile(resolve(web, 'teams.html'), 'utf8')
      await writeFile(resolve(output, 'teams.html'), html.replace('<head>', `<head><meta name="paramyth-api" content="${base}">`))
      await copyFile(resolve(web, 'teams.css'), resolve(output, 'teams.css'))
      await copyFile(resolve(web, 'js/teams.js'), resolve(output, 'js/teams.js'))
    },
  }],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
