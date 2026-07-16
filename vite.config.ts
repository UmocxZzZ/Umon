import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

// Audio proxy to bypass CORS restrictions for Web Audio API
function audioProxyPlugin() {
  return {
    name: 'audio-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/__audio-proxy', async (req, res) => {
        const url = req.url?.slice(1) // Remove leading /
        if (!url) {
          res.statusCode = 400
          res.end('Missing URL')
          return
        }
        try {
          const decodedUrl = decodeURIComponent(url)
          const target = new URL(decodedUrl)
          const isAllowedProtocol = target.protocol === 'http:' || target.protocol === 'https:'
          const isAllowedHost = target.hostname === 'music.126.net'
            || target.hostname.endsWith('.music.126.net')
          if (!isAllowedProtocol || !isAllowedHost) {
            res.statusCode = 403
            res.end('Audio host is not allowed')
            return
          }

          const headers = new Headers()
          if (req.headers.range) headers.set('Range', req.headers.range)

          const response = await fetch(target, { headers })
          if (!response.ok) {
            res.statusCode = response.status
            res.end('Fetch failed')
            return
          }
          res.statusCode = response.status
          // Forward headers and add CORS
          res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Accept-Ranges', response.headers.get('accept-ranges') || 'bytes')
          // Forward Content-Length and Content-Range for duration detection
          const contentLength = response.headers.get('content-length')
          if (contentLength) res.setHeader('Content-Length', contentLength)
          const contentRange = response.headers.get('content-range')
          if (contentRange) res.setHeader('Content-Range', contentRange)
          // Stream the response
          const reader = response.body?.getReader()
          if (reader) {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              res.write(value)
            }
          }
          res.end()
        } catch (e) {
          console.error('[audio-proxy] error:', e)
          res.statusCode = 500
          res.end('Proxy error')
        }
      })
    },
  }
}

const isElectron = process.env.ELECTRON === 'true'
const pkg = JSON.parse(fs.readFileSync(path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'package.json'), 'utf-8'))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE || 'http://localhost:3000'

  return {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    vue(),
    tailwindcss(),
    audioProxyPlugin(),
    ...(isElectron
      ? [
          electron([
            {
              entry: 'electron/main.ts',
              vite: {
                build: {
                  outDir: 'dist-electron',
                  rollupOptions: {
                    external: ['electron'],
                  },
                },
              },
            },
          ]),
          renderer(),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiBase,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const cookie = req.headers['x-umon-cookie']
            proxyReq.removeHeader('x-umon-cookie')
            if (typeof cookie === 'string' && cookie) {
              proxyReq.setHeader('Cookie', cookie)
            } else {
              proxyReq.removeHeader('Cookie')
            }
          })
        },
      },
    },
  },
  }
})
