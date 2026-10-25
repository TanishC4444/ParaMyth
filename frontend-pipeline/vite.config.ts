import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { extname, relative, resolve, isAbsolute } from 'node:path'

// Match the studio launcher's /studio mount during frontend-pipeline development too.
const studioRoot = fileURLToPath(new URL('../web', import.meta.url))
const contentTypes: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' }

// Keep the exported app runnable without the Figma Make preview runtime.
export default defineConfig({
  server: { proxy: Object.fromEntries(['/api','/media','/export','/google','/docs','/openapi.json','/workflows','/testing','/connections','/writing','/ideas','/outputs','/legacy','/console','/tools','/production','/music','/images'].map(path => [path, {
    target: process.env.PARAMYTH_BACKEND || 'http://127.0.0.1:8770', changeOrigin: true,
    configure(proxy: any) { proxy.on('proxyReq', (out: any, req: any) => { if (req.headers.origin === `http://${req.headers.host}`) out.setHeader('Origin', process.env.PARAMYTH_BACKEND || 'http://127.0.0.1:8770') }) },
  }])) },
  plugins: [react(), tailwindcss(), {
    name: 'studio-pages',
    configureServer(server) {
      server.middlewares.use('/studio', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        let pathname: string
        try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname) }
        catch { res.statusCode = 400; res.end('Invalid path'); return }
        const target = resolve(studioRoot, `.${pathname === '/' ? '/index.html' : pathname}`)
        const inside = relative(studioRoot, target)
        if (inside.startsWith('..') || isAbsolute(inside) || !contentTypes[extname(target)]) { res.statusCode = 404; res.end('Not found'); return }
        readFile(target).then((body) => {
          res.setHeader('Content-Type', `${contentTypes[extname(target)]}; charset=utf-8`)
          res.end(req.method === 'HEAD' ? undefined : body)
        }).catch(() => { res.statusCode = 404; res.end('Not found') })
      })
    },
  }],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
