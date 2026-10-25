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
      for(const name of ['teams','account']){
        const html = await readFile(resolve(web, name+'.html'), 'utf8')
        await writeFile(resolve(output, name+'.html'), html.replace('<head>', `<head><meta name="paramyth-api" content="${base}">`))
        await copyFile(resolve(web, 'js/'+name+'.js'), resolve(output, 'js/'+name+'.js'))
      }
      await copyFile(resolve(web, 'teams.css'), resolve(output, 'teams.css'))
      const entry = await readFile(resolve('dist/index.html'), 'utf8')
      const assets = entry.match(/<(?:script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script|link\b[^>]*(?:rel="stylesheet"|rel="modulepreload")[^>]*)>/g) || []
      const missing = await readFile(resolve('dist/404.html'), 'utf8')
      await writeFile(resolve('dist/404.html'), missing.replace('<!-- app-entry -->', assets.join('\n')))
    },
  }],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
