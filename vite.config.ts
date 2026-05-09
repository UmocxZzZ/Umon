import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const cookieFile = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '.debug-cookie')

function debugCookiePlugin() {
  return {
    name: 'debug-cookie',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/__debug-cookie', (req, res) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk })
          req.on('end', () => {
            fs.writeFileSync(cookieFile, body, 'utf-8')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: cookieFile }))
          })
        } else if (req.method === 'GET') {
          const exists = fs.existsSync(cookieFile)
          const content = exists ? fs.readFileSync(cookieFile, 'utf-8') : ''
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ exists, content }))
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
    debugCookiePlugin(),
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
      },
    },
  },
  }
})
